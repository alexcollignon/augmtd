// Commitment extraction — "what I owe / what I'm owed", from emails and meetings.
// W9.4 EXTRACTION IS REASONED, NOT KEYWORD-GATED: the email path is gated STRUCTURALLY
// (`extractionGate` below) — the conversation delta always runs (it is a no-op without open work),
// and NEW extraction runs on the per-item understanding / authorship / source, never a keyword list.

import { getAIClient, aiCreate } from '@/lib/ai/factory';
import { subjectIsCampaignEcho } from '@/lib/inbox/campaign-echo';
import { isOwnCoworkerSender } from '@/lib/inbox/self-echo';
import { resolveDeixisInDescriptions } from '@/lib/inbox/deixis';
import { seatStripsObligation, type SeatFacts } from '@/lib/inbox/recipient-role';
import { dueDateFromSource, repairSelfParty, denotesUser, isOpenDuplicate, type UserForms } from '@/lib/commitments/extraction-truth';
import { directionFloor } from '@/lib/commitments/direction';
import { coerceUnderstanding, type ItemUnderstanding } from '@/lib/inbox/item-understanding';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DBClient = any;

export type ExtractedCommitment = {
  direction: 'you_owe' | 'awaiting';
  description: string;
  due_date?: string | null;
  counterparty?: string | null;
  initiative?: string | null; // deal/client/project this belongs to (for project grouping); null = one-off
  // G1 (work-surface): the obligation's SUB-PARTS ("attach the deck", "include pricing") — one
  // commitment per MOTION, its clauses as steps. Persisted as the commitment's item plan.
  steps?: string[];
  /** W7.4 THE DIRECTION FLOOR: WHO performs the act, as the extraction named it ("user" or the other
   *  party's name/email). Code-verified against the user's identity (lib/commitments/direction.ts). */
  doer?: string | null;
  /** W15.4 A PROMISE IS QUOTED OR IT ISN'T A PROMISE: the EXACT words in the source message that make
   *  this commitment (the user's own promise · the counterparty's ask · the meeting line). Code-checked
   *  against the message's own words (`promiseQuoteFloor`); no verifiable quote → no commitment. */
  quote?: string | null;
  /** W15.4: the extraction's judgment that the quote is an EXPLICIT FIRST-PERSON commitment with a
   *  deliverable or action (required for a user-authored you_owe — a pitch or an offer is not one). */
  explicit_promise?: boolean | null;
};

// Clean an initiative label (drop the model's "null"/"none" filler; cap length).
function cleanInitiative(v: unknown): string | null {
  const s = typeof v === 'string' ? v.trim() : '';
  return s && !/^(null|none|n\/a|na|unknown|one-off|one off)$/i.test(s) ? s.slice(0, 60) : null;
}

// W9.4: a SECONDARY hint only — consulted by `extractionGate` in the one case no reasoned signal
// exists (no understanding yet AND the user is CC-only). Never the sole gate: English-only keywords
// cannot see "done, attached", "erledigt, anbei" or "cancelamos a reunião".
const COMMITMENT_HINT = /\b(i'?ll|i will|we'?ll|we will|let me|i'?ll get|send you|get you|send over|follow up|circle back|will send|will get|will have|will share|by (mon|tue|wed|thu|fri|sat|sun|monday|tuesday|wednesday|thursday|friday|tomorrow|eod|cob|end of|next week|this week|end of day|end of week)|deadline|by the end|due |get back to you|revert|by then)\b/i;

// Bulk / newsletter / automated mail — never a source of personal commitments. An "unsubscribe"
// footer is a near-perfect signal that this is a broadcast, not a 1:1 message.
const BULK_HINT = /unsubscribe|view (this )?(e?-?mail )?in (your )?browser|manage (your )?(e?mail )?preferences|update your preferences|you'?re receiving this|sent to you because|no longer wish to receive|email preferences|all rights reserved/i;

// (W7.4) The from-user FIRST_PERSON_PROMISE backstop is RETIRED: it tested the DESCRIPTION for
// "I'll…", but THE TITLE LAW makes every description an imperative — so it flipped EVERY user-sent
// commitment to `awaiting` ("Contact <counterparty> to schedule demo" stored as the counterparty's
// debt). Direction is now WHO DOES IT — the extraction's `doer`, code-verified: lib/commitments/direction.ts.

// Attendee alias helpers now live in the shared identity module (single source across the initiative
// machine — commitments + calendar bridging). Same agnostic logic, one definition.
import { norm, emailLocalpart, nameTokens, emailDenotesName, sameAttendee } from '@/lib/projects/identity';
import { dateStatedInText } from '@/lib/utils/user-time';
import { topMessageOf } from '@/lib/inbox/top-message';
import { conversationDelta, quoteInText, type ConversationKey, type DeltaJudge, type ApplyDeps } from '@/lib/work/conversation-delta';

// ── EXTRACTION TRUTH floors (W8.2 · ONE CONVERSATION, ONE LIVE ITEM) ─────────────────────────────
// Pure, zero AI. The write door (writeCommitments) and the repair (scripts/repair-conversation-hoard.ts)
// ask the SAME functions.

/**
 * THE DUE-BEFORE-SOURCE FLOOR. A due date earlier than the source's own day (one day of timezone
 * tolerance) is not a deadline this source set — found live: "Share updated report" extracted from
 * an Aug 10 email carried due Aug 8. Dropped to null. When the obligation's OWN TITLE names that past
 * date ("Attend the Aug 8 review"), the obligation itself is already past at its source → no
 * commitment at all (`drop`). Pure.
 */
export function dueFloorAgainstSource(
  due: string | null | undefined, anchorIso: string | null | undefined, description: string,
): { due: string | null; drop: boolean; floored: boolean } {
  if (!due || !/^\d{4}-\d{2}-\d{2}$/.test(due) || !anchorIso || Number.isNaN(Date.parse(anchorIso))) return { due: due ?? null, drop: false, floored: false };
  const floorDay = new Date(Date.parse(`${new Date(anchorIso).toISOString().slice(0, 10)}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  if (due >= floorDay) return { due, drop: false, floored: false };
  return { due: null, drop: dateStatedInText(description, due), floored: true };
}

// ── W15.4 A PROMISE IS QUOTED OR IT ISN'T A PROMISE ─────────────────────────────────────────────
// Found live (owner, Sep 24): "why items on my sent emails?" — since W9.4 every user-authored message
// is extracted, and a you_owe was minted from the user's own sent reply whose words read as a pitch,
// not a promise; the item never said WHY it existed. THE LAW, at the one write door (writeCommitments):
// every extracted commitment carries `quote` — the exact words in the source message that make it —
// and code checks the quote EXISTS in the message's own words (THE SAME checker the conversation delta
// uses: `quoteInText` — accent/case/quote-mark/whitespace folded, ≥6 chars per fragment, in order).
// No verifiable quote → no commitment (logged, counted). A user-authored you_owe additionally needs
// the extraction's judgment that the quote is an EXPLICIT FIRST-PERSON commitment with a deliverable
// or action (`explicit_promise: true`) — reasoned by the model with the quote as proof, never a keyword
// list. The quote is stored (`commitments.source_quote`) and served by the source reader
// (lib/commitments/source.ts) so the item says "You wrote: '…'" / "<Name> asked: '…'".
/** The extraction prompt + the quote law's shape. Bump when either changes (lib/core/versions.ts). */
export const COMMITMENT_EXTRACTION_VERSION = 2;
/** The longest quote the store keeps (quoteInText refuses a longer one anyway). */
export const QUOTE_MAX_CHARS = 400;
export type QuoteFloorReason = 'no-quote' | 'quote-not-in-own-words' | 'not-first-person';
export type QuoteFloorVerdict = { keep: true; quote: string } | { keep: false; reason: QuoteFloorReason };

/**
 * THE QUOTE FLOOR (pure, zero AI): may this candidate become a commitment? `ownWords` is the source
 * message's OWN words (topMessageOf for mail — never the quoted chain; the transcript for a meeting).
 * `authoredByUser` = the user wrote the message: then a you_owe must be judged an explicit first-person
 * commitment (`explicit_promise === true`). The kept quote is trimmed of wrapping quote marks.
 */
export function promiseQuoteFloor(
  c: { direction?: string | null; quote?: unknown; explicit_promise?: unknown },
  ctx: { ownWords: string | null | undefined; authoredByUser: boolean },
): QuoteFloorVerdict {
  const raw = typeof c.quote === 'string' ? c.quote.trim() : '';
  const quote = raw.replace(/^["'“”‘’«»]+|["'“”‘’«»]+$/g, '').trim();
  if (!quote) return { keep: false, reason: 'no-quote' };
  if (!quoteInText(quote, String(ctx.ownWords ?? ''))) return { keep: false, reason: 'quote-not-in-own-words' };
  if (ctx.authoredByUser && c.direction === 'you_owe' && c.explicit_promise !== true) return { keep: false, reason: 'not-first-person' };
  return { keep: true, quote: quote.slice(0, QUOTE_MAX_CHARS) };
}

/** Is this insert error the not-yet-applied `source_quote` column (the pending migration)? Pure. */
export const missingQuoteColumn = (err: { message?: string | null; code?: string | null } | null | undefined): boolean =>
  !!err && /source_quote/.test(String(err.message ?? '')) && (err.code === 'PGRST204' || err.code === '42703' || /column|schema cache/i.test(String(err.message ?? '')));

/** Split "Name <addr>" / a bare address / a bare name. Pure. */
function whoParts(raw: string): { name: string | null; email: string | null } {
  const s = raw.trim();
  const m = /^(.*?)<([^>]+@[^>]+)>\s*$/.exec(s);
  if (m) return { name: m[1].replace(/^["']|["']$/g, '').trim() || null, email: m[2].trim() };
  if (s.includes('@') && !/\s/.test(s)) return { name: null, email: s };
  return { name: s || null, email: null };
}

/** Does this address STRICTLY spell this name (first.last@, firstlast@, flast@)? Never a contains-guess. Pure. */
export function emailSpellsName(email: string, name: string): boolean {
  const local = emailLocalpart(email);
  const t = nameTokens(name);
  if (!local || t.length < 2) return false;
  const first = t[0], last = t[t.length - 1];
  return [t.join(''), first + last, first[0] + last, last + first].includes(local);
}

/**
 * Two NAME forms of one human? Accent-folded tokens (THE ONE ACCENT FOLD); the first names agree and
 * every further token of the shorter form matches a later token of the longer one — equal, or an
 * initial / a ≥3-letter prefix ("Sam R." · "Sam Rivera" · "Sam Rivera Costa"). A one-token form never
 * folds on its own (a first name is not a person). Pure.
 */
export function nameFormsAgree(a: string, b: string): boolean {
  const ta = nameTokens(a), tb = nameTokens(b);
  if (!ta.length || !tb.length) return false;
  if (ta.join(' ') === tb.join(' ')) return true;
  const tryDir = (s: string[], l: string[]): boolean => {
    if (s.length < 2 || s.length > l.length || s[0] !== l[0]) return false;
    let j = 1;
    for (let i = 1; i < s.length; i++) {
      const tok = s[i];
      let hit = false;
      for (; j < l.length; j++) {
        if (l[j] === tok || ((tok.length === 1 || tok.length >= 3) && l[j].startsWith(tok))) { hit = true; j++; break; }
      }
      if (!hit) return false;
    }
    return true;
  };
  return tryDir(ta, tb) || tryDir(tb, ta);
}

type RegistryPerson = { name: string; aliases?: string[] | null; state?: { self?: boolean } | null };

/**
 * THE COUNTERPARTY FOLD — one human, one form. Resolution order: (1) the person registry, exact on
 * any folded alias/address/name; (2) the registry by name form (nameFormsAgree) or a strictly-spelled
 * address — only when exactly ONE person answers; (3) the conversation's own forms (the other open
 * items' counterparties on the same thread + the batch) — only when they all denote one human, and a
 * one-token first name only when exactly one conversation human carries it. The fuller form wins (a
 * name over a bare address, more tokens over fewer). Ambiguity or no evidence → the raw form, honest.
 * Pure.
 */
export function foldCounterparty(
  raw: string | null | undefined, registry: RegistryPerson[], conversation: Array<string | null | undefined> = [],
): string | null {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  const { name, email } = whoParts(s);
  const people = registry.filter((p) => p?.name && p.state?.self !== true);
  const fe = email ? norm(email) : null;
  const fn = name ? norm(name) : null;
  const formsOf = (p: RegistryPerson) => [p.name, ...(p.aliases ?? [])].map((f) => norm(String(f ?? ''))).filter(Boolean);
  const uniq = (ps: RegistryPerson[]) => [...new Map(ps.map((p) => [p.name, p])).values()];

  const exact = uniq(people.filter((p) => formsOf(p).some((f) => (fe && f === fe) || (fn && f === fn))));
  if (exact.length === 1) return exact[0].name;
  if (exact.length > 1) return s;
  const fuzzy = uniq(people.filter((p) => formsOf(p).some((f) =>
    (fn && !f.includes('@') && nameFormsAgree(fn, f)) || (fe && !fn && !f.includes('@') && emailSpellsName(fe, f)))));
  if (fuzzy.length === 1) return fuzzy[0].name;
  if (fuzzy.length > 1) return s;

  const forms = [...new Set(conversation.map((f) => String(f ?? '').trim()).filter((f) => f && norm(f) !== norm(s)))];
  const denotes = (f: string): boolean => {
    const w = whoParts(f);
    if (fe && w.email && norm(w.email) === fe) return true;
    if (fn && w.name && nameFormsAgree(fn, w.name)) return true;
    if (fe && !fn && w.name && emailSpellsName(fe, w.name)) return true;
    if (fn && !w.name && w.email && emailSpellsName(w.email, fn)) return true;
    return false;
  };
  let hits = forms.filter(denotes);
  if (!hits.length && fn && nameTokens(fn).length === 1) {
    // A bare first name folds only onto the ONE conversation human who carries it.
    hits = forms.filter((f) => { const w = whoParts(f); return !!w.name && nameTokens(w.name)[0] === nameTokens(fn)[0]; });
  }
  if (!hits.length) return s;
  // All hits must be ONE human (pairwise agreement), else ambiguous.
  const nameOf = (f: string) => whoParts(f).name;
  const named = hits.filter((f) => nameOf(f));
  for (let i = 0; i < named.length; i++) for (let j = i + 1; j < named.length; j++) {
    if (!nameFormsAgree(nameOf(named[i])!, nameOf(named[j])!)) return s;
  }
  const score = (f: string) => { const n = nameOf(f); return n ? 10 + nameTokens(n).length : 0; };
  const best = [...hits, s].sort((a, b) => score(b) - score(a))[0];
  return score(best) > score(s) ? (nameOf(best) ?? best) : s;
}

export function validDate(d: unknown): string | null {
  if (typeof d !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
  return d;
}

// ── Near-duplicate detection (general, language/text-agnostic) ────────────────────────────────
// Two commitment descriptions are "the same obligation" when their content words overlap heavily —
// used to collapse the near-identical fragments an over-eager extractor emits for one action
// ("Send the deck to Sam", "Send Sam the deck", "Send over the deck"). NO string special-casing:
// it works purely off token overlap, so it holds for any wording, any language's word boundaries.
const DUP_STOPWORDS = new Set([
  'the', 'a', 'an', 'to', 'for', 'of', 'and', 'or', 'with', 'on', 'in', 'at', 'by', 'from', 'up',
  'out', 'over', 'about', 'into', 'as', 'is', 'be', 'will', 'would', 'should', 'need', 'needs',
  'please', 'get', 'send', 'this', 'that', 'it', 'them', 'me', 'you', 'we', 'i', 'he', 'she', 'they',
]);
// The signal-bearing tokens of a description — lowercased words, stopwords dropped, deduped.
function contentTokens(s: string): Set<string> {
  const toks = norm(s).replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean)
    .filter((t) => t.length > 2 && !DUP_STOPWORDS.has(t));
  return new Set(toks);
}
// Jaccard-style overlap over content tokens. ≥ threshold ⇒ the same obligation. A high default (0.6)
// keeps this conservative — it merges obvious restatements, never distinct tasks that share a noun.
export function isNearDuplicate(a: string, b: string, threshold = 0.6): boolean {
  const na = norm(a), nb = norm(b);
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true; // one description is a substring of the other
  const ta = contentTokens(a), tb = contentTokens(b);
  if (!ta.size || !tb.size) return false;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  const union = ta.size + tb.size - inter;
  return union > 0 && inter / union >= threshold;
}

function parseJson(text: string): any {
  let raw = text.trim();
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) raw = fenced[1].trim();
  try { return JSON.parse(raw); } catch { /* */ }
  const a = raw.indexOf('{'), b = raw.lastIndexOf('}');
  if (a >= 0 && b > a) return JSON.parse(raw.slice(a, b + 1));
  throw new Error('no json');
}

// Insert new commitments for a source, skipping ones already captured. Dedup is at THREE levels, all
// general (token-overlap, no text special-casing): (1) against commitments already stored for this
// source, (2) WITHIN the incoming batch (first occurrence wins), and (3) CROSS-SOURCE against the
// user's OPEN commitments in the SAME context — same counterparty or same initiative (projecthood-plan
// P5: a recurring meeting re-stating "secure the pilot project" must not mint a sibling every week —
// the wall of near-dupes). The context guard keeps generic phrasings ("send the proposal") from
// folding across unrelated deals. due_date is written ONLY when it survives validDate (an absolute
// YYYY-MM-DD) — a fabricated / unparseable date collapses to null rather than a made-up deadline.
export async function writeCommitments(
  userId: string,
  list: ExtractedCommitment[],
  // B2 (workbench): `status` — meeting-extracted commitments land as 'suggested' (a review gate:
  // meetings are noisy; the user Accepts/Rejects). Email-extracted stay 'open' (explicit written text).
  meta: {
    source: 'email' | 'meeting'; sourceId: string; threadId?: string | null; counterparty?: string | null; status?: 'open' | 'suggested';
    /** The SOURCE's own date (email received_at / meeting start) — THE FORWARD ANCHOR for every date. */
    anchorAt?: string | null;
    /** The source's own words, when at hand — a stated window must be stated THERE, not only in the title. */
    sourceText?: string | null;
    /** The source's OTHER party (email sender/recipient, a 1:1 meeting's counterpart) — THE SELF-PARTY LAW's re-derivation. */
    otherParty?: string | null;
    /** The user's own name + addresses — who the user IS, beside the self person entity. */
    user?: { name?: string | null; addresses?: Array<string | null | undefined> | null } | null;
    /** W8.2 THE CONVERSATION DELTA: the message's OWN words (topMessageOf) + who wrote it. Absent on
     *  the meeting path — the delta reads the meeting's summary + action items itself. */
    message?: { text?: string | null; authoredByUser?: boolean | null; subject?: string | null;
      /** W11.2 — the sender of a message the user did not write (the delta places it on the ladder). */
      authorAddress?: string | null } | null;
    /** The delta's injectable judge/appliers (the zero-AI gates stub them; production omits it). */
    delta?: { judge?: DeltaJudge; deps?: ApplyDeps } | null;
    /** W15.4 THE QUOTE FLOOR's text for a MEETING source (the transcript / notes). Mail needs none —
     *  its own words are the message's (topMessageOf). A meeting caller that hands none is the legacy
     *  path: its rows land 'suggested' (the review gate), unquoted, and are counted. */
    ownWords?: string | null;
  },
  client: DBClient,
): Promise<void> {
  const clean0 = (list ?? []).filter((c) => c?.description?.trim());
  // (W8.2) An EMPTY batch still reaches the conversation delta below — a message that minted nothing
  // new may still have delivered, replaced or cancelled the conversation's open work. Every candidate
  // query is skipped for it; the delta itself makes no call when the conversation holds no open work.
  const hasCandidates = clean0.length > 0;

  // IDENTITY first (orchestrated-loop O1b + THE SELF-PARTY LAW, W3.4): who the user is — the self
  // person entity's name + aliases, plus the caller's name/addresses — so no row is born naming the
  // user as their own counterparty, in the field OR in the title's "with X".
  const { getPersonEntities, resolveIdentity } = await import('@/lib/entities/people');
  const persons = hasCandidates ? await getPersonEntities(client as never, userId).catch(() => []) : [];
  // W7.5: the user's forms come from THE ONE CODE-OWNED DERIVATION (lib/entities/self), never from
  // the stored self row's aliases — a polluted row once made a client "the user" here.
  const { loadUserForms } = await import('@/lib/prepare/addressee');
  const owned = hasCandidates ? await loadUserForms(client as never, userId).catch(() => ({ name: null, aliases: [] }) as UserForms) : ({ name: null, aliases: [] } as UserForms);
  const userForms: UserForms = {
    name: meta.user?.name || owned.name || null,
    aliases: [...(owned.aliases ?? []), ...(meta.user?.addresses ?? [])],
  };
  const other = meta.otherParty ?? meta.counterparty ?? null;
  const authoredByUser = meta.message?.authoredByUser === true;
  const quoteWords = meta.source === 'email'
    ? (meta.message?.text ?? (meta.sourceText ? topMessageOf(meta.sourceText) : ''))
    : (meta.ownWords ?? null);
  const quoteLaw = meta.source === 'email' || typeof meta.ownWords === 'string';
  const quoteFloor: Record<QuoteFloorReason | 'legacyUnquoted', number> = { 'no-quote': 0, 'quote-not-in-own-words': 0, 'not-first-person': 0, legacyUnquoted: 0 };
  const clean = clean0.map((c) => {
    // THE DIRECTION FLOOR (W7.4) — who DOES it decides the direction, before anything else reads it.
    const floor = directionFloor(
      { direction: c.direction, description: c.description, counterparty: c.counterparty ?? meta.counterparty ?? null, doer: c.doer ?? null },
      userForms, other && !denotesUser(other, userForms) ? other : null,
    );
    if (floor.direction !== c.direction) c = { ...c, direction: floor.direction };
    const fixed = repairSelfParty(
      { description: c.description.trim(), counterparty: c.counterparty ?? null, direction: c.direction }, userForms,
      other && !denotesUser(other, userForms) ? other : null,
    );
    return fixed.changed
      ? { ...c, description: fixed.description, counterparty: fixed.counterparty, direction: (fixed.direction as ExtractedCommitment['direction']) ?? c.direction }
      : c;
  }).flatMap((c): ExtractedCommitment[] => {
    // W15.4 THE QUOTE FLOOR — a promise is quoted or it isn't a promise. Mail: the quote must exist in
    // the message's OWN words; a user-authored you_owe must be judged an explicit first-person
    // commitment. Meeting: checked against the transcript when the caller hands it (`ownWords`).
    // Applied AFTER the direction floor, so the first-person rule reads the final direction.
    if (!quoteLaw) { quoteFloor.legacyUnquoted++; return [{ ...c, quote: null }]; }
    const v = promiseQuoteFloor(c, { ownWords: quoteWords, authoredByUser });
    if (v.keep) return [{ ...c, quote: v.quote }];
    quoteFloor[v.reason]++;
    return [];
  });
  if (quoteFloor['no-quote'] || quoteFloor['quote-not-in-own-words'] || quoteFloor['not-first-person'] || quoteFloor.legacyUnquoted) {
    console.log(`[commitments] quote floor v${COMMITMENT_EXTRACTION_VERSION} ${meta.source}:${meta.sourceId.slice(0, 8)} candidates=${clean0.length} dropped: no-quote=${quoteFloor['no-quote']} not-in-own-words=${quoteFloor['quote-not-in-own-words']} not-first-person=${quoteFloor['not-first-person']}${quoteFloor.legacyUnquoted ? ` legacy-unquoted=${quoteFloor.legacyUnquoted}` : ''}`);
  }

  const { data: existing } = hasCandidates ? await client.from('commitments')
    .select('description').eq('user_id', userId).eq('source_id', meta.sourceId) : { data: [] };
  const existingDescs = (existing ?? []).map((e: { description: string }) => e.description || '');
  // The user's LIVE commitments from OTHER sources — the cross-source restatement pool. 'suggested'
  // meeting rows are live too: a second meeting re-stating one still pending review is the same
  // obligation (THE OPEN-DUPLICATE LAW — the census found 15 groups, 33 rows).
  const { data: openOther } = hasCandidates ? await client.from('commitments')
    .select('description, counterparty, initiative, direction, thread_id, source_id, created_at').eq('user_id', userId)
    .in('status', ['open', 'suggested'])
    .neq('source_id', meta.sourceId).order('created_at', { ascending: false }).limit(400) : { data: [] };
  const openRows = (openOther ?? []) as Array<{ description: string; counterparty: string | null; initiative: string | null; direction: string | null; thread_id: string | null; source_id: string | null; created_at: string | null }>;
  const nowIso = new Date().toISOString();

  const accepted: ExtractedCommitment[] = [];
  for (const c of clean) {
    const desc = c.description.trim();
    const rawCp = (c.counterparty || meta.counterparty || '').toString();
    const cpId = rawCp ? resolveIdentity(persons, rawCp) : null;
    const cp = cpId?.canonical ?? rawCp;
    const init = (c.initiative || '').toString().toLowerCase().trim();
    // Drop if it restates something already stored for this source, or one we've already accepted
    // from this same batch (first occurrence wins).
    const dupExisting = existingDescs.some((d: string) => isNearDuplicate(desc, d));
    const dupBatch = accepted.some((a) => isNearDuplicate(desc, a.description));
    // Cross-source: near-identical text (0.5) + a shared context anchor (counterparty or initiative).
    const dupCross = openRows.some((d) => {
      if (!isNearDuplicate(desc, d.description, 0.5)) return false;
      const sameParty = !!cp && !!d.counterparty && sameAttendee(cp, d.counterparty);
      const sameInit = !!init && !!d.initiative && d.initiative.toLowerCase().trim() === init;
      return sameParty || sameInit;
    });
    // THE OPEN-DUPLICATE LAW (W3.4): same direction + the shared 0.6 bar + the same thread, or the
    // same counterparty within 14 days — ONE predicate, shared with the merge-report sweep.
    const dupOpen = openRows.some((d) => isOpenDuplicate(
      { description: desc, direction: c.direction, counterparty: cp || null, thread_id: meta.threadId ?? null, source_id: meta.sourceId, created_at: nowIso },
      d, (a, b) => isNearDuplicate(a, b),
    ));
    if (dupExisting || dupBatch || dupCross || dupOpen) continue;
    accepted.push(c);
  }

  // ── G1 backstop (work-surface): ONE OBLIGATION = ONE TASK. Same-counterparty, same-direction
  // fragments in one batch (the meeting insights extractor emits granular action items) get ONE
  // reasoned check: are these parts of a single motion? Merge → one commitment + steps. Conservative
  // by prompt (genuinely separate obligations stay apart); any failure → the batch stands as-is. ──
  let consolidated = accepted;
  if (accepted.length > 1) {
    try {
      const groups = new Map<string, number[]>();
      accepted.forEach((c, i) => {
        const key = `${c.direction}·${(c.counterparty || meta.counterparty || '').toString().toLowerCase().trim() || `solo-${i}`}`;
        (groups.get(key) ?? groups.set(key, []).get(key)!).push(i);
      });
      const merged = new Set<number>();
      const additions: ExtractedCommitment[] = [];
      for (const g of [...groups.values()].filter((x) => x.length > 1)) {
        const listTxt = g.map((i, n) => `${n}. ${accepted[i].description}`).join('\n');
        const { client: ai, model } = await getAIClient(userId, 'classification', client);
        const res = await aiCreate(ai, {
          model, max_tokens: 300, temperature: 0,
          messages: [{ role: 'user', content:
            `These tasks were extracted from ONE ${meta.source} with the SAME counterparty:\n${listTxt}\n\n` +
            `Are they parts of a SINGLE motion — one thing you'd mark done ONCE (e.g. one reply that must cover all of them)? ` +
            `Merge ONLY if clearly one deliverable/motion; genuinely separate obligations (different deliverables, different moments) stay separate.\n` +
            `JSON only: {"merge":true,"description":"<the one motion, short imperative>","steps":["<part>", "..."]} or {"merge":false}` }],
        });
        const parsed = JSON.parse((res.choices?.[0]?.message?.content ?? '{}').replace(/^```(json)?|```$/gm, '').trim()) as { merge?: boolean; description?: string; steps?: string[] };
        if (parsed.merge === true && parsed.description?.trim()) {
          g.forEach((i) => merged.add(i));
          const first = accepted[g[0]];
          additions.push({
            ...first,
            description: parsed.description.trim(),
            steps: [...new Set([...(Array.isArray(parsed.steps) ? parsed.steps : []), ...g.flatMap((i) => accepted[i].steps ?? [])])].slice(0, 5),
            due_date: g.map((i) => accepted[i].due_date).filter(Boolean).sort()[0] ?? null, // earliest stated
          });
        }
      }
      if (merged.size) consolidated = [...accepted.filter((_, i) => !merged.has(i)), ...additions];
    } catch { /* consolidation is an enhancement — the batch stands */ }
  }

  // THE STATED WINDOW (W3.4): the model's date, re-anchored forward from the SOURCE's own date,
  // widened to the END of a window the description states (verified in the source's own words);
  // no stated date → null. The expiry law only ever sees rows that carry a due_date.
  // THE DUE-BEFORE-SOURCE FLOOR (W8.2): a due earlier than the source's own day is no deadline this
  // source set → null; a title that itself names that past date is already past → no commitment.
  const dated = consolidated.map((c) => {
    const due = validDate(dueDateFromSource({ modelDate: c.due_date, description: c.description, sourceText: meta.sourceText ?? null, anchorIso: meta.anchorAt ?? null }));
    const f = dueFloorAgainstSource(due, meta.anchorAt ?? null, c.description);
    return { c, due: f.due, drop: f.drop };
  }).filter((d) => !d.drop);

  // IDENTITY RESOLUTION at the write (orchestrated-loop O1b) — the counterparty RESOLVES through the
  // person registry instead of being transcribed: one human never lands under two labels (the
  // canonical name wins), and a counterparty that resolves to the USER'S OWN self entity is a
  // structural impossibility with structural consequences — an "awaiting" on yourself IS your own
  // task (direction flips to you_owe), and you can never be your own counterparty (null; the display
  // layer derives a source label). W8.2 THE COUNTERPARTY FOLD: a form the registry does not hold
  // verbatim folds — accent/short-form/bare-address — onto the ONE human the registry or the
  // conversation's own forms name (`foldCounterparty`); ambiguity stays raw — honest, and alias fodder.
  const convForms = [
    ...openRows.filter((r) => meta.threadId && r.thread_id === meta.threadId).map((r) => r.counterparty),
    ...consolidated.map((c) => c.counterparty ?? null), meta.counterparty ?? null,
  ];
  const built = dated.map(({ c, due }) => {
    const rawCp = (c.counterparty || meta.counterparty || null)?.toString().slice(0, 200) ?? null;
    const id = resolveIdentity(persons, rawCp);
    const isSelf = id.isSelf || (!!rawCp && denotesUser(rawCp, userForms));
    const direction = isSelf ? 'you_owe' : (c.direction === 'awaiting' ? 'awaiting' : 'you_owe');
    const counterparty = isSelf ? null : (id.canonical ?? foldCounterparty(rawCp, persons, convForms) ?? rawCp);
    return {
      c,
      row: {
        user_id: userId,
        direction,
        description: c.description.trim().slice(0, 500),
        counterparty,
        due_date: due,
        initiative: cleanInitiative(c.initiative),
        source: meta.source,
        source_id: meta.sourceId,
        thread_id: meta.threadId ?? null,
        status: meta.status ?? 'open',
        // W15.4 — WHY this commitment exists, in the source's own words (served by lib/commitments/source.ts).
        source_quote: c.quote ? String(c.quote).slice(0, QUOTE_MAX_CHARS) : null,
      } as Record<string, unknown> & { description: string; direction: string; counterparty: string | null; due_date: string | null },
    };
  });

  // ── W8.2 ONE CONVERSATION, ONE LIVE ITEM — THE CONVERSATION DELTA. The ONE call site: the new
  // message is read against the conversation's OPEN work (the thread's live commitments; a meeting's
  // earlier series meetings) — each open item kept · updated · superseded · delivered (nominated to
  // the fulfillment judge; only a judged delivery closes) · moot, each candidate new or a duplicate
  // of an open item (not written). Failure keeps everything. lib/work/conversation-delta.ts ──
  const key: ConversationKey | null = meta.source === 'email'
    ? (meta.threadId ? { kind: 'thread', threadId: meta.threadId, excludeSourceId: meta.sourceId } : null)
    : { kind: 'meeting', transcriptId: meta.sourceId };
  const delta = await conversationDelta(client, userId, {
    key,
    candidates: built.map(({ row }) => ({ description: row.description, direction: row.direction, counterparty: row.counterparty, due_date: row.due_date })),
    message: {
      kind: meta.source, id: meta.sourceId, at: meta.anchorAt ?? null,
      text: meta.message?.text ?? (meta.source === 'email' && meta.sourceText ? topMessageOf(meta.sourceText) : null),
      authoredByUser: meta.message?.authoredByUser ?? null, subject: meta.message?.subject ?? null,
      authorAddress: meta.message?.authorAddress ?? null,
    },
    judge: meta.delta?.judge, deps: meta.delta?.deps,
  }).catch(() => null);
  const writeIdx = delta ? delta.writeIndices : built.map((_, i) => i);
  const toWrite = writeIdx.map((i) => built[i]);
  const rows = toWrite.map((b) => b.row);
  let inserted: Array<{ id: string; description: string }> | null = null;
  if (rows.length) {
    let { data, error } = await client.from('commitments').insert(rows).select('id, description');
    // Code works BEFORE the pending migration (20260924_commitment_source_quote.sql): the column is
    // missing → the same rows, without the quote (the floor above has already run — only the display
    // of WHY waits for the migration).
    if (error && missingQuoteColumn(error)) {
      ({ data, error } = await client.from('commitments')
        .insert(rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => k !== 'source_quote')))).select('id, description'));
    }
    if (error) console.error('[commitments] insert failed:', error.message);
    inserted = (data ?? null) as Array<{ id: string; description: string }> | null;
  }
  if (delta) {
    // Insert returns rows in insert order; a description match is the fallback alignment.
    const ids = rows.map((r, k) => inserted?.[k]?.description === r.description ? inserted[k].id : (inserted ?? []).find((x) => x.description === r.description)?.id ?? null);
    const report = await delta.settle(ids);
    if (report.updated || report.superseded || report.moot || report.deliveredClosed || report.duplicates || report.leftBehind) {
      console.log(`[conversation-delta] ${meta.source}:${meta.sourceId.slice(0, 8)} kept=${report.kept} updated=${report.updated} superseded=${report.superseded} moot=${report.moot} delivered=${report.deliveredClosed}/${report.deliveredNominated} duplicates=${report.duplicates} leftBehind=${report.leftBehind}`);
    }
  }
  if (!rows.length) return;
  const consolidatedWritten = toWrite.map((b) => b.c);

  // ── G1: the obligation's STEPS persist as its item plan (the deep-dive checklist), version-stamped
  // so the plan route serves them instead of regenerating. Non-fatal. ──
  try {
    const withSteps = consolidatedWritten.filter((c) => Array.isArray(c.steps) && c.steps.length >= 2);
    if (withSteps.length && inserted?.length) {
      const { PLAN_VERSION } = await import('@/lib/home/capability-map');
      const byDesc = new Map(inserted.map((r) => [r.description, r.id]));
      for (const c of withSteps) {
        const cid = byDesc.get(c.description.trim().slice(0, 500));
        if (!cid) continue;
        await client.from('item_plans').upsert({
          user_id: userId, kind: 'commitment', entity_id: cid,
          tasks: c.steps!.slice(0, 5).map((s, i) => ({ id: `g1-${i}`, text: String(s).slice(0, 120), actor: 'you', done: false, clause: true })),
          version: PLAN_VERSION, updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id,kind,entity_id' });
      }
    }
  } catch { /* steps are an enhancement — the commitments landed */ }
}

// Meeting commitments — map already-extracted action items to commitments (no AI needed).
// The user's items = you_owe; items assigned to others = awaiting (they owe the user).
//
// Counterparty: for an item assigned to someone else it's the assignee. For a USER task it's left to
// the one clear counterpart when the meeting has exactly ONE identifiable other participant (a 1:1)
// — otherwise null (genuinely unresolvable in a group meeting; the display layer derives a source
// label instead of printing a placeholder). Source-agnostic: keyed off the passed attendee list, no
// names hardcoded.
//
// due_date: passed straight through validDate (in writeCommitments) — an absolute YYYY-MM-DD stays,
// anything else (a fabricated / relative / null value) becomes null. We never invent a date here.
// Write-time dedup (writeCommitments) collapses the near-identical fragments an over-eager insights
// pass emits for one obligation, so a meeting yields a small set of real commitments, not a backlog.
// THE 1:1 COUNTERPART REDUCTION, at ONE address (extracted Sep 18 so the counterparty BACKFILL
// asks the same question the write path asks — a second copy of this is a second answer). Strip the
// user in ANY form (their name, an address that denotes it, a known address of theirs), collapse the
// rest into DISTINCT people alias-aware, prefer a display name over an email as the label, and
// return a counterpart ONLY when exactly one person remains. A group meeting reduces to null — the
// display layer derives a source label; a placeholder is never printed and a name is never invented.
export function soleCounterpartOf(
  attendees: Array<string | null | undefined> | null | undefined,
  userName?: string | null,
  userEmails?: Array<string | null | undefined> | null,
): string | null {
  const uName = userName || '';
  const userNorm = norm(uName);
  const mine = new Set((userEmails ?? []).map((e) => (e || '').toString().toLowerCase().trim()).filter(Boolean));
  const notUser = [...new Set((attendees ?? []).map((a) => (a || '').toString().trim()).filter(Boolean))]
    .filter((a) => {
      if (mine.has(a.toLowerCase())) return false;
      const local = emailLocalpart(a);
      if (!userNorm) return true;
      if (norm(a) === userNorm) return false;
      return !(local && emailDenotesName(local, uName));
    });
  const people: string[] = [];
  for (const a of notUser) {
    const idx = people.findIndex((p) => sameAttendee(p, a));
    if (idx === -1) people.push(a);
    else if (emailLocalpart(people[idx]) && !emailLocalpart(a)) people[idx] = a; // prefer a name over an email
  }
  return people.length === 1 ? people[0] : null;
}

export async function writeMeetingCommitments(
  userId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  actionItems: Array<{ action?: string; assignee?: string | null; isUserTask?: boolean | null; dueDate?: string | null; due_date?: string | null;
    /** W15.4 — the meeting line that makes this action item (verbatim from the transcript/notes). */
    quote?: string | null }>,
  meta: { transcriptId: string; attendees?: Array<string | null | undefined> | null; userName?: string | null; meetingDate?: string | null;
    /** W15.4 THE QUOTE FLOOR's text: the transcript / notes the action items were drawn from. Handed →
     *  every item must quote a line of it (no quote → no commitment). Absent → the legacy path. */
    transcriptText?: string | null },
  client: DBClient,
): Promise<void> {
  // The set of "other" participants (attendee names that aren't the user). Used only to resolve a
  // 1:1 counterpart for a user task — never to fabricate a name.
  // Strip the user in ANY form, collapse the rest alias-aware, and take the counterpart only from a
  // genuine 1:1 — ONE implementation, shared with the counterparty backfill (soleCounterpartOf).
  const soleCounterpart = soleCounterpartOf(meta.attendees, meta.userName);

  // Persist the initiative at write time (meeting commitments were born initiative-less and only got one
  // via the read-time person-bridge). Resolve each counterpart's GROUNDED canonical — the same label the
  // deal's emails carry — so a meeting joins the right project durably (and clusters immediately). Only when
  // the contact has ONE clear initiative (no other variants) — mirrors the bridge's "exactly one" safety;
  // ambiguous (multiple deals) or a brand-new contact → null (loose), never a guessed assignment.
  const { getInitiativeCandidates } = await import('@/lib/inbox/initiative-candidates');
  const initByPerson = new Map<string, string | null>();
  const resolveInitiative = async (cp: string | null): Promise<string | null> => {
    if (!cp) return null;
    const k = cp.toLowerCase().trim();
    if (initByPerson.has(k)) return initByPerson.get(k) ?? null;
    const { canonical, candidates } = await getInitiativeCandidates(client, userId, { personNames: [cp], personEmails: [cp] }).catch(() => ({ canonical: null, candidates: [] as string[] }));
    const val = canonical && candidates.length === 0 ? canonical : null;
    initByPerson.set(k, val);
    return val;
  };

  const list: ExtractedCommitment[] = [];
  for (const a of actionItems ?? []) {
    if (!a?.action?.trim()) continue;
    const isUser = a.isUserTask === true || a.isUserTask == null || !a.assignee;
    // Assigned-to-other → the assignee. User task → the sole counterpart if this was a 1:1, else null
    // (unresolvable in a group meeting; display derives a source label).
    const counterparty = isUser ? soleCounterpart : (a.assignee ?? soleCounterpart ?? null);
    list.push({
      direction: isUser ? 'you_owe' : 'awaiting',
      // THE DIRECTION FLOOR (W7.4): the insights pass's own ACTOR field rides as the doer — the
      // writer code-verifies it against the user's identity (an assignee who IS the user, in any of
      // their forms, is the user's own deed).
      doer: isUser ? 'user' : (a.assignee ?? null),
      description: a.action!.trim(),
      due_date: a.dueDate ?? a.due_date ?? null,
      counterparty,
      initiative: await resolveInitiative(counterparty),
      quote: typeof a.quote === 'string' ? a.quote : null,
    } as ExtractedCommitment);
  }
  // B2: meeting follow-ups are PROPOSED, not imposed — they land 'suggested' for the user's
  // Accept/Reject (the review gate the cognitive-cost doctrine always implied for noisy extraction).
  await writeCommitments(userId, list, {
    source: 'meeting', sourceId: meta.transcriptId, threadId: null, status: 'suggested',
    anchorAt: meta.meetingDate ?? null, otherParty: soleCounterpart, user: { name: meta.userName ?? null },
    ...(typeof meta.transcriptText === 'string' ? { ownWords: meta.transcriptText } : {}),
  }, client);
}

// ── THE DEIXIS SCRUBBER — MOVED (proactive-reach LAW 3, THE SERVED-WORDS LAW).
// This module used to OWN the resolver, which is precisely why the law decayed into a site list:
// commitment descriptions were scrubbed and the two fields the deck actually leads with
// (`understanding.ask`, `work_title`) were not. The resolver and its multilingual day-word table now
// live in ONE shared seam — `lib/inbox/deixis.ts` — applied at EVERY write seam. Re-exported here so
// the historical callers (and the gates that pin them) keep pointing at the one law. ──
export { DEICTIC_RE, resolveDeixisInDescriptions } from '@/lib/inbox/deixis';

// ── W9.4 EXTRACTION IS REASONED, NOT KEYWORD-GATED ─────────────────────────────────────────────
// THE FINDING (read-only audit, Sep 23): extraction AND the W8.2 conversation delta ran only when the
// message passed an English keyword regex. "Done, attached", a cancellation in any other language —
// anything that missed the list — never reached the delta and waited for the 6h evidence sweep.
// THE LAW: two questions, two answers, neither lexical.
//   • THE DELTA always runs when the message has words: it is bounded (DELTA_MAX_OPEN), it makes NO
//     call when the conversation holds no open work (loadConversation answers first), and reading a
//     new message against open work is the point of W8.2.
//   • NEW EXTRACTION runs on a REASONED or STRUCTURAL signal: a meeting source; a user-authored
//     message (you-owe promises); or the per-item understanding (lib/inbox/item-understanding.ts —
//     ownership you_owe/awaiting · relevance action/reply · an ask · a stated deadline). The kind floor
//     skips bulk/newsletter/receipt/notification/cold-outreach. With NO understanding yet (sync runs
//     extraction before the classification pass lands), mail the user is ADDRESSED on extracts — the
//     caller's own triage already called it actionable, and the prompt returns [] for no obligation;
//     only a CC-only message with no understanding consults the keyword hint, as a secondary signal.
/** Mail kinds that never mint a personal commitment (the reasoned taxonomy, not a keyword list). */
export const NOISE_MAIL_KINDS: ReadonlySet<string> = new Set(['receipt', 'newsletter', 'notification', 'cold_outreach']);
/** Below this, a message is too short to CARRY a new obligation — it can still settle one (delta). */
export const EXTRACT_MIN_CHARS = 20;

export type GateUnderstanding = Pick<ItemUnderstanding, 'ownership' | 'relevance' | 'ask' | 'deadline' | 'mailKind' | 'bulk' | 'role'>;
export type ExtractionFacts = {
  source: 'email' | 'meeting';
  /** The message's text (email body). */
  text: string;
  isFromUser: boolean;
  /** The reasoned per-item understanding for THIS message, when it has landed. */
  understanding?: Partial<GateUnderstanding> | null;
  /** The user is only CC'd (structural seat). Unknown = null. */
  ccOnly?: boolean | null;
  /** Structural broadcast footer (unsubscribe / view-in-browser) on received mail. */
  bulkFooter?: boolean;
  /** A reply into the user's own outbound sequence (THE ECHO FLOOR). */
  campaignEcho?: boolean;
  /** The sender is one of the user's own coworkers (THE SELF-RECOGNITION FLOOR). */
  coworkerSender?: boolean;
  /** The sync's own triage class for received mail. noise / fyi_only never mint (they get no
   *  understanding, so the unjudged-addressed branch must not fire for them) — the delta still reads them. */
  triage?: 'noise' | 'fyi_only' | 'process' | null;
  /** The user's to-do capture switch (todo_auto). false = never mint NEW commitments; the conversation
   *  delta still runs (settling open work is not capture). Absent = on. */
  mintNew?: boolean;
};
export type ExtractionGate = { delta: boolean; extract: boolean; basis: string };

/** Does the reasoned understanding say this message carries an obligation? Pure. */
export function understandingIndicatesObligation(u: Partial<GateUnderstanding> | null | undefined): boolean {
  if (!u) return false;
  if (u.ownership === 'you_owe' || u.ownership === 'awaiting') return true;
  if (u.relevance === 'action' || u.relevance === 'reply') return true;
  return !!(u.ask && String(u.ask).trim()) || !!(u.deadline && String(u.deadline).trim());
}

/** THE GATE (pure, zero AI): does this message reach the conversation delta, and does it get a NEW
 *  extraction call? Order = precedence; the first floor that answers wins. */
export function extractionGate(f: ExtractionFacts): ExtractionGate {
  const text = String(f.text ?? '').trim();
  // Our own coworker's words are a pointer to work that stands — not evidence, not a new debt.
  if (f.coworkerSender && !f.isFromUser) return { delta: false, extract: false, basis: 'coworker-sender' };
  const delta = text.length > 0;
  if (f.mintNew === false) return { delta, extract: false, basis: 'mint-off' };
  if (f.source === 'meeting') return { delta, extract: true, basis: 'meeting' };
  if (text.length < EXTRACT_MIN_CHARS) return { delta, extract: false, basis: 'too-short' };
  if (!f.isFromUser && (f.triage === 'noise' || f.triage === 'fyi_only')) return { delta, extract: false, basis: 'triage-noise' };
  const u = f.understanding ?? null;
  if (!f.isFromUser && (f.bulkFooter || u?.bulk === true || (u?.mailKind && NOISE_MAIL_KINDS.has(u.mailKind)))) {
    return { delta, extract: false, basis: 'noise-kind' };
  }
  if (!f.isFromUser && f.campaignEcho) return { delta, extract: false, basis: 'campaign-echo' };
  if (f.isFromUser) return { delta, extract: true, basis: 'user-authored' };
  if (u) {
    return understandingIndicatesObligation(u)
      ? { delta, extract: true, basis: 'understanding' }
      : { delta, extract: false, basis: 'understanding-no-obligation' };
  }
  if (f.ccOnly !== true) return { delta, extract: true, basis: 'addressed-unjudged' };
  return COMMITMENT_HINT.test(text)
    ? { delta, extract: true, basis: 'cc-hint' }
    : { delta, extract: false, basis: 'cc-unjudged' };
}

/** The understanding the classification pass stamped for THIS message (the thread's item carries
 *  the understanding of its LATEST message — only a match on this email id is fresh). Bounded,
 *  explicit select, JSON path only (never the body). Any error → null (unjudged). */
export async function understandingForEmail(client: DBClient, userId: string, emailId: string, threadId?: string | null): Promise<GateUnderstanding | null> {
  try {
    let q = client.from('inbox_items').select('understanding:source_data->understanding, email_id:source_data->>email_id')
      .eq('user_id', userId).eq('source', 'email');
    q = threadId ? q.eq('source_data->>thread_id', threadId) : q.eq('source_data->>email_id', emailId);
    const { data, error } = await q.limit(5);
    if (error || !Array.isArray(data)) return null;
    const row = (data as Array<{ understanding?: unknown; email_id?: string | null }>).find((r) => r.email_id === emailId);
    return row ? coerceUnderstanding(row.understanding) : null;
  } catch { return null; }
}

// Extract commitments from one email and persist them. Returns the count written.
export async function extractEmailCommitments(opts: {
  userId: string;
  subject: string;
  body: string;
  isFromUser: boolean;     // true = the user sent it
  userName: string | null;
  counterparty: string | null;  // the other party (recipient if sent, sender if received)
  sourceId: string;
  threadId?: string | null;
  instructions?: string;   // user's custom extraction guidance (Email tab → To-do capture)
  /** The email's OWN date — the deixis anchor ("tomorrow" in a 3-day-old email is 3 days ago's
   *  tomorrow, never extraction-day's). Falls back to now when absent. */
  receivedAt?: string | null;
  /** THE SEAT LAW (threads-plan · THE OPENING CONTRACT clause 4): the user's To/CC position on this
   *  email. Absent = unknown, and an unknown seat never demotes anything. */
  seat?: SeatFacts | null;
  /** W9.4: the reasoned understanding for THIS message, when the caller holds it. Absent → looked up
   *  (inbox_items.source_data.understanding, only when stamped for this email id); null → unjudged. */
  understanding?: Partial<GateUnderstanding> | null;
  /** W9.4: the user's to-do capture switch (todo_auto). false → no NEW commitments; the delta still runs. */
  mintNew?: boolean;
  /** W9.4: the sync's triage class for received mail — noise / fyi_only never mint (delta only). */
  triage?: 'noise' | 'fyi_only' | 'process' | null;
  /** The conversation delta's injectable judge/appliers — zero-AI gates only; production omits it. */
  delta?: { judge?: DeltaJudge; deps?: ApplyDeps } | null;
  client: DBClient;
}): Promise<number> {
  const { userId, subject, body, isFromUser, userName, counterparty, sourceId, threadId, instructions, receivedAt, seat, client } = opts;
  const text = (body || '').trim();
  // THE SELF-RECOGNITION FLOOR (Q1 — attention-plan PART III): a coworker's own mail never mints a
  // commitment. Their reminder ("approve the shortlist") is a POINTER to work that already stands —
  // minting from it is how ONE ask came to stand four times on the reference account (three
  // re-sent reminders plus the commitment one of them minted). The user does not owe their own
  // assistant a debt. `counterparty` IS the sender on the received path, so no new parameter: the
  // registry predicate reads the address the caller already hands us. Structural, zero AI.
  const coworkerSender = !isFromUser && isOwnCoworkerSender(counterparty);
  // THE ECHO FLOOR (LAW 5 — proactive-reach): a reply into the user's OWN outbound sequence never
  // mints a commitment. The census found a lunch commitment minted for a meeting that never
  // existed, off one sequencer reply. Derived per user from their own sent corpus at runtime — no
  // vendor, token or language is named; an empty signature leaves this inert. (W9.4: the reply can
  // still SETTLE open work on its conversation — the delta reads it; it only never mints.)
  // The lookups below only matter when minting is still possible — skipped otherwise (no wasted IO).
  const triage = opts.triage ?? null;
  const mayMint = opts.mintNew !== false && !coworkerSender && text.length >= EXTRACT_MIN_CHARS
    && (isFromUser || (triage !== 'noise' && triage !== 'fyi_only'));
  const campaignEcho = !isFromUser && mayMint
    ? await subjectIsCampaignEcho(client, userId, subject).catch(() => false) : false;
  // W9.4 THE GATE — reasoned/structural, never a keyword list (see `extractionGate`).
  const understanding = isFromUser || !mayMint ? null
    : opts.understanding !== undefined ? opts.understanding : await understandingForEmail(client, userId, sourceId, threadId);
  const gate = extractionGate({
    source: 'email', text, isFromUser, understanding, triage, mintNew: opts.mintNew,
    ccOnly: seat?.isCcOnly ?? null,
    // Received bulk/newsletter mail never carries a real commitment (structural footer backstop).
    bulkFooter: !isFromUser && BULK_HINT.test(text),
    campaignEcho, coworkerSender,
  });
  if (!gate.delta && !gate.extract) return 0;
  const list = gate.extract ? await extractCandidates() : [];
  // (W8.2 + W9.4) EVERY gated message reaches writeCommitments — an empty list included: the
  // conversation delta reads it against the conversation's OPEN work (a delivery or a cancellation
  // mints nothing new), and makes no call when the conversation holds none.
  try {
    await writeCommitments(userId, list, {
      source: 'email', sourceId, threadId, counterparty,
      anchorAt: receivedAt ?? null, sourceText: `${subject || ''}\n${text}`, otherParty: counterparty,
      user: { name: userName || seat?.userName || null, addresses: seat?.userAddresses ?? null },
      message: { text: topMessageOf(text), authoredByUser: isFromUser, subject: subject || null,
        // W11.2: on the received path `counterparty` IS the sender — the delta asks the ladder.
        authorAddress: isFromUser ? null : (counterparty ?? null) },
      delta: opts.delta ?? null,
    }, client);
  } catch { return 0; }
  return list.length;

  // ── the NEW-extraction call (only when the gate says so); any failure → no candidates ──
  async function extractCandidates(): Promise<ExtractedCommitment[]> {
    const who = userName || 'the user';
    // Context-grounded initiative: the labels this counterparty/thread already carries, so a commitment
    // reuses the existing deal label instead of inventing a synonym (converges with the email understanding).
    const { getInitiativeCandidates, initiativeGroundingClause } = await import('@/lib/inbox/initiative-candidates');
    const initCand = await getInitiativeCandidates(client, userId, { threadId, personNames: [counterparty], personEmails: [counterparty] }).catch(() => ({ canonical: null, candidates: [] as string[] }));
    const initiativeGrounding = initiativeGroundingClause(initCand.canonical, initCand.candidates);
    const perspective = isFromUser
      ? `This email was SENT BY ${who}. Things ${who} promises to do = direction "you_owe". Things ${who} asks or requests the other party to do (and is now waiting on) = direction "awaiting". CRITICAL: because ${who} is the SENDER, an imperative or request aimed at the other party ("process the refund", "please send X", "can you review Y") is something the OTHER party owes — direction "awaiting" — NOT something ${who} owes. Only a first-person promise by ${who} ("I'll…", "I will…", "let me…", "we'll…") is "you_owe". THE PROMISE LAW: a "you_owe" from ${who}'s own email exists ONLY when ${who} wrote an EXPLICIT FIRST-PERSON COMMITMENT to a deliverable or an action ("I'll send the deck on Monday", "I will get back to you by Friday", "vou enviar a proposta amanhã", "je vous envoie le contrat") — its quote must BE that sentence, and "explicit_promise" is true only then. A pitch, a description of what a product or team can do, an offer or invitation ("happy to show you…", "we can set up…", "let me know if…"), a pleasantry or a plan stated without committing to it is NOT a promise — return nothing for it.`
      : `This email was RECEIVED BY ${who} from ${counterparty || 'someone'}. Things the other party asks ${who} to do = direction "you_owe". Things the other party promises to do for ${who} = direction "awaiting".`;

    const prompt = `Extract concrete COMMITMENTS from this email — a SPECIFIC obligation a party EXPLICITLY took on, or is explicitly owed, between ${who} and a REAL person (e.g. "Send the Q3 proposal", "Review the contract by Friday").

What counts as ONE commitment — be selective, prefer FEWER and higher-confidence:
- ONE commitment per MOTION/DELIVERABLE — the thing you'd mark done ONCE. A reply that must include pricing, a deck, and answers to two questions is ONE commitment ("Reply to X with the pilot proposal") whose parts go into "steps" — NEVER four sibling commitments.
- "steps": 2-5 short sub-parts of that one motion ("attach the deck", "include 7-8 seat pricing", "answer the data-source question"), or [] when the obligation has no distinct parts.
- A clear, explicit obligation with an owner. NOT every idea, sub-step, suggestion, aside, or granular task mentioned in passing.
- When in doubt, LEAVE IT OUT. A short list of real obligations is far better than a long list of maybes.

STRICTLY EXCLUDE and return an empty array if the message is a newsletter, promotion, receipt, invoice, or automated notification. NEVER treat marketing/newsletter calls-to-action as commitments — e.g. "reply with Q2", "submit your story", "subscribe", "reply for early access", "share your feedback", editorial/publishing schedules, or any mass-email ask. Also exclude CONDITIONAL or OPTIONAL offers ("reply if you need…", "let me know if you'd like…", "feel free to…", "happy to … if useful") — these are invitations, not commitments. Ignore pleasantries, vague intentions ("let's catch up sometime"), and anything already done.

${perspective}

due_date: set it ONLY when THIS email explicitly states a deadline — an absolute date, or an unambiguous relative one ("by Friday", "by EOD", "next Tuesday", "in 3 days"). THIS EMAIL IS DATED ${(receivedAt && !isNaN(Date.parse(receivedAt)) ? new Date(receivedAt) : new Date()).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })} — resolve every relative time FORWARD FROM THAT DATE (its "tomorrow" is the day after IT was sent, not after today), to an absolute YYYY-MM-DD. If no deadline is stated in the email, due_date MUST be null. NEVER guess, infer, or invent a plausible date — a missing deadline is null, not a made-up one.

counterparty: the specific real person this obligation is with (who owes it, or is owed it), drawn from this email's actual participants — the sender or a named recipient. Use null only when genuinely unidentifiable; never invent a name.

doer: WHO must PERFORM the action — "user" when ${who} does it, otherwise the other party's name or email exactly as in this email. direction MUST agree with it: doer "user" ⇒ "you_owe"; doer the other party ⇒ "awaiting". An action ${who} takes TOWARD the other party ("Contact X", "Send X the material", "Schedule the demo with X", "Follow up with X") is done BY ${who} — doer "user", direction "you_owe".

initiative: the specific deal, client, project, internal initiative, or goal this commitment belongs to — including a hiring effort, product launch, migration, or other bounded internal effort. Use a short proper-noun label derived from THIS email's own content, or null for a one-off or an ongoing category such as invoices, receipts, or newsletters. Two DIFFERENT clients/companies/initiatives ALWAYS get DIFFERENT labels; the SAME ongoing effort gets a CONSISTENT label. Never invent a label.
${initiativeGrounding}${instructions?.trim() ? `\nThe user added this guidance — follow it: ${instructions.trim()}\n` : ''}
Subject: ${subject || '(none)'}
Body:
"""
${text.slice(0, 2500)}
"""

quote — THE QUOTE LAW: every commitment MUST carry "quote": the EXACT words, copied VERBATIM from THIS message's own text (not from quoted earlier messages below it, not paraphrased, not translated), that make the commitment — ${isFromUser ? `${who}'s own promise (you_owe) or ${who}'s own request (awaiting)` : `the other party's ask of ${who} (you_owe) or their own promise (awaiting)`}. One sentence or clause, at most ~200 characters. If you cannot quote such words, it is not a commitment — leave it out.
explicit_promise: true ONLY when the quote is an explicit first-person commitment by its writer to a deliverable or an action; false otherwise.

description — THE TITLE LAW: a short IMPERATIVE, at most ~9 words, starting with a verb and naming the deliverable ("Send the Q3 proposal", "Review the contract by Friday"). NEVER notes/narration phrasing ("Discussed the possibility of…", "It was agreed that…", "X mentioned…", "Follow up regarding the conversation about…") and never a sentence describing the conversation — the title is the TASK, written the way it would sit on a to-do list.
THE DEIXIS LAW: a stored title must stay TRUE as time passes — never write relative time words ("tomorrow", "today", "tonight", "next week", "this Friday") into the description. Resolve them against THIS EMAIL'S OWN DATE above and write the absolute instead: "Be at the meeting room at 12:30 tomorrow" (sent Jul 27) → "Be at the meeting room — Jul 28, 12:30". Clock times stay; day-words become dates.

Return ONLY JSON. Empty array if there are no real commitments:
{"commitments":[{"direction":"you_owe|awaiting","doer":"user | the other party's name/email","quote":"the exact words from this message","explicit_promise":true,"description":"short imperative, e.g. 'Send the Q3 proposal'","due_date":"YYYY-MM-DD or null","counterparty":"name/email or null","initiative":"short label or null","steps":["short sub-part", "..."]}]}`;

    try {
      const { client: ai, model } = await getAIClient(userId, 'summarization', client);
      const res = await aiCreate(ai, { model, messages: [{ role: 'user', content: prompt }], max_tokens: 700, temperature: 0.2 });
      const parsed = parseJson(res.choices?.[0]?.message?.content ?? '');
      let list = (parsed.commitments ?? []) as ExtractedCommitment[];
      // THE DIRECTION FLOOR (W7.4) — direction is WHO DOES IT, decided by ONE pure law
      // (lib/commitments/direction.ts): the extraction's named `doer`, code-verified against the
      // user's identity; else the object position ("Contact X…" is done TO X, so BY the user). The
      // retired backstop keyed a from-user row on "I'll…" in the DESCRIPTION — which the title law
      // makes imperative — and so flipped every user-sent deed to `awaiting`. One conservative residue
      // survives, and ONLY where the model omitted the doer it was asked for: a from-user row with no
      // doer and no object evidence reads as a request to the other party (the refund-ask class).
      {
        const forms = { name: userName || seat?.userName || null, aliases: seat?.userAddresses ?? null };
        list = list.map((c) => {
          const f = directionFloor({ direction: c.direction, description: c.description, counterparty: c.counterparty ?? counterparty, doer: c.doer ?? null }, forms, counterparty);
          const direction = isFromUser && f.basis === 'model' && !String(c.doer ?? '').trim() && f.direction === 'you_owe'
            ? 'awaiting' : f.direction;
          return direction === c.direction ? c : { ...c, direction };
        });
      }
      // THE SEAT LAW (threads-plan · THE OPENING CONTRACT clause 4) — the sibling of the backstop
      // above, keyed off WHO WAS ADDRESSED instead of who sent it. A request addressed To: a third
      // party with the user merely in CC is that party's obligation: it is not the user's `you_owe`,
      // and re-directioning it to `awaiting` would be a second lie (the user is not owed a stranger's
      // deliverable either), so the honest outcome is NO ROW — the mail stays visible as awareness,
      // which is the seat it actually holds. Deterministic, zero AI, positive evidence only (an
      // unstamped/unknown seat demotes nothing). EXCEPTION: the mail names the user directly — a CC'd
      // person asked for something by name genuinely owes it. Found live: the sender asked the To:
      // recipient for THAT person's CV and the user, in CC, was served "You owe <sender>".
      if (!isFromUser && seatStripsObligation(`${subject || ''}\n${text}`, seat)) {
        list = list.filter((c) => c.direction !== 'you_owe');
      }
      // THE DEIXIS LAW, structural belt (T-class): a title carrying a relative time word decays into
      // a lie ("tomorrow" is only true for a day) — detection is lexical, the REWRITE is reasoned
      // (one capped call, only for offenders), anchored to the email's own date.
      if (list.length) list = await resolveDeixisInDescriptions(client, userId, list, receivedAt ?? null);
      return list;
    } catch {
      return [];
    }
  }
}
