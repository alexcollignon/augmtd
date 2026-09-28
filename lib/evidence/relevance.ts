// ════════════════════════════════════════════════════════════════════════════════════════════════
// EVIDENCE IS ABOUT ITS OBJECT (stabilization W19.A · invariant 7 EVIDENCE SETTLES; owner walk Sep 28).
//
// THE FINDING: the verdict on a commitment the COUNTERPARTY owed us (a presentation + agent docs)
// discussed the user's bank details — because evidence is gathered BY PERSON: every later message
// from that counterparty, on any thread, was nominated against every open obligation with them, and
// a message asking for a different thing (the RIB) became "evidence" about the presentation.
//
// THE LAW: a piece of evidence connected to a work item ONLY through its PERSON (or the weaker entity
// membership) must also be ABOUT that work — its own words (the top message, the quoted chain
// removed) share the work's matter. The OBJECT key (the work's own thread / event / file / house
// ref — W18's same-conversation rule) needs no such test, and neither does a meeting (THE MEETING
// CLAUSE is the judge's, and W16 already bounds when a meeting may raise "looks done"). A work item
// whose description carries no matter words (nothing to test against) vetoes nothing.
//
// Pure, zero IO, zero AI, client-safe. The IO half (hydrating the ≤N nominated bodies) lives with
// the nominator (lib/work/evidence-nominator `gateEvidenceAboutWork`).
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { topMessageOf } from '@/lib/inbox/top-message';

const fold = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

/** The piece's OWN words — THE ONE PARSER (lib/inbox/top-message: every reply-client header
 *  convention, the French Outlook block included), whitespace-collapsed. No second copy lives here. */
export function ownWordsOf(body: string): string {
  return topMessageOf(String(body ?? '')).replace(/\s+/g, ' ').trim();
}

/** Content tokens: ≥4 letters, or a short ACRONYM as written (RIB, NDA, SOW). */
function tokens(text: string): string[] {
  const raw = String(text ?? '');
  const acronyms = new Set((raw.match(/\b[A-Z]{2,5}\b/g) ?? []).map((a) => fold(a)));
  return [...new Set(fold(raw).split(/[^\p{L}\p{N}]+/u).filter((t) => t && !/^\d+$/.test(t) && (t.length >= 4 || acronyms.has(t))))];
}

/** The work's MATTER words — its description without the leading imperative (THE TITLE LAW makes
 *  every description start with its verb: "Send …", "Review …"; the verb is the deed, not the topic). */
export function workMatterTokens(description: string, skip: ReadonlySet<string> = new Set()): string[] {
  const words = String(description ?? '').trim().split(/\s+/);
  const rest = words.length > 1 ? words.slice(1).join(' ') : words.join(' ');
  return tokens(rest).filter((t) => !skip.has(t));
}

/** Same matter word — exact, or the same 5-letter stem across inflections ("document"/"documentation"). */
const sameWord = (a: string, b: string) => a === b || (a.length >= 5 && b.length >= 5 && a.slice(0, 5) === b.slice(0, 5));

export function sharesMatter(text: string, matter: readonly string[]): boolean {
  if (!matter.length) return false;
  const have = tokens(text);
  return have.some((h) => matter.some((m) => sameWord(h, m)));
}

export type RelevanceInput = {
  key?: 'object' | 'person' | 'entity';
  deed?: string;
  status?: 'held' | 'booked';
  title?: string | null;
  /** the piece's own words, when hydrated (the quoted chain is removed here). */
  body?: string | null;
  attachmentCount?: number | null;
};

/**
 * Is this nominated piece ABOUT the work? Pure. true for the object key, a meeting, or a work with no
 * matter words; otherwise the piece's own words must share the work's matter — its body's top
 * message when it has words (the subject is the CONVERSATION's topic, shared by every message on it),
 * else its title; an attachment-bearing piece with a matter-sharing title passes too ("here it is"
 * + the file).
 */
export function aboutWork(ev: RelevanceInput, description: string, skip: ReadonlySet<string> = new Set()): boolean {
  if (ev.key === 'object' || !ev.key) return true;
  if (ev.status || /^meeting_/.test(String(ev.deed ?? ''))) return true;
  const matter = workMatterTokens(description, skip);
  if (!matter.length) return true; // nothing to test against — no veto signal
  const own = ev.body ? ownWordsOf(String(ev.body)) : '';
  if (own && sharesMatter(own, matter)) return true;
  if (!own && sharesMatter(String(ev.title ?? ''), matter)) return true;
  if ((ev.attachmentCount ?? 0) > 0 && sharesMatter(String(ev.title ?? ''), matter)) return true;
  return false;
}
