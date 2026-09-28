// ════════════════════════════════════════════════════════════════════════════════════════════════
// HOME ASK — the Home chat's WORLD PAGE. `buildBrainSnapshot` assembles the bounded page the one
// conversation (lib/converse) reads as its context on Home: the user's work as the app judges it
// (THE ONE USER GROUNDING), plus the focused project's full room page when the message names one.
// The focus/filing claim matchers (`findEntityFocus`, `suggestFilingFocus`) live here too. W22: the
// records-only answering pass that used to live here is retired (see the note at the bottom).
// ════════════════════════════════════════════════════════════════════════════════════════════════

import type { SupabaseClient } from '@supabase/supabase-js';
// THE ONE IDENTITY PRIMITIVE — never a second generic-word list. `namesStatedIn`/`distinctiveTokens`
// are built on GENERIC_WORK_WORDS (lib/entities/recognize), the same law the case pre-pass, the
// workflow-scope seam and the named-subject veto speak.
import { namesStatedIn, distinctiveTokens } from '@/lib/workflows/case-step';
import { topMessageOf } from '@/lib/inbox/top-message';
import { projectHref } from '@/lib/room/project-href';
import { GROUND_EVIDENCE_RULE } from '@/lib/room/ground-evidence';
import { clipWithRule } from '@/lib/utils/pack-context';

/** `tag` is the grounding id the answer placed ([E7], [R2]…) — THE identity a chip resolves by.
 *  Optional only because the type is also read back from turns stored before that law. */
export type AskRef = { id: string; kind: 'entity' | 'inbox_item' | 'commitment' | 'meeting' | 'file'; label: string; href: string | null; tag?: string };
export type AskAnswer = { answer: string; refs: AskRef[] };
export type AskTurn = { role: 'user' | 'assistant'; text: string };

const entHref = (id: string) => projectHref(id);

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE FOCUS MATCH / THE FILING CLAIM (one-surface § the one grounding, Aug 5 — hardened Sep 21).
//
// A focus — and above all the composer's filing chip — is a CLAIM that this conversation is about
// that project. Found live on a pilot: a conversation entirely about scheduling a press interview
// offered "About <subject-shaped project name>? · File it" for a project with nothing to do with
// it. Three defects, one class: the match needed only ONE of a name's distinctive tokens, it read
// them with a bare `includes` (a substring is not a name), and it read the WHOLE ask — including a
// pasted email the user had quoted into it. A wide machine-founded name plus a long paste is a
// near-guaranteed spurious hit.
//
// THE LAW A PROJECT CLAIM MUST MEET:
//   (a) IDENTITY, WHOLE — candidacy is `namesStatedIn` (lib/workflows/case-step): EVERY distinctive
//       token of the name/alias, word-bounded. Never the summary, never a partial overlap. The
//       house scorer still RANKS the qualified (longest matched weight). This is the Aug-25 scoping
//       guard's law, moved from the workflow lane into the one matcher every lane calls.
//   (b) THE USER'S OWN WORDS — a claim reads the evidence text, not the transport: quoted/forwarded
//       material is cut structurally (topMessageOf), and a paste-sized remainder is discounted to
//       the user's own framing around it. A pasted email mentioning a word is not the user naming
//       a project.
//   (c) TRACKED FIRST — filing is SUGGESTED only for human-created projects (the pinning law:
//       projects are human-created; untracked machine-founded entities fold, they never claim).
//   (d) SILENCE BEATS A WRONG CLAIM — two candidates tied at the top is ambiguity, and ambiguity
//       is a refusal. The ONE ordering rule below a tie: an entity's own name outranks an alias.
// Pure + exported for the deterministic gates.
// ════════════════════════════════════════════════════════════════════════════════════════════════

export type FocusCandidate = { id: string; name: string; aliases?: string[] | null; tracked?: boolean | null };

/** Past this, an ask is carrying pasted material, not a sentence the user wrote. */
const PASTE_CHARS = 900;
/** How much of the user's own framing survives around a paste (head and tail). */
const FRAMING_CHARS = 300;

/** THE EVIDENCE TEXT — what the USER said, as opposed to what they transported. Quoted/forwarded
 *  history is cut by the house's reply-convention parser; what remains, if it is still paste-sized,
 *  is reduced to the framing the user typed around it (people paste in the middle, and ask at the
 *  edges). Pure; exported so the gates can assert the discount on the function that owns it. */
export function askEvidenceText(text: string): string {
  const top = topMessageOf(String(text ?? '')).trim();
  if (top.length <= PASTE_CHARS) return top;
  return `${top.slice(0, FRAMING_CHARS)}\n${top.slice(-FRAMING_CHARS)}`;
}

/** Ranking weight for one entity against one text: the longest whole-name match it can show. An
 *  entity's OWN name outranks an equally-weighted ALIAS (found live: an over-merged entity carries
 *  a neighbour's name among its aliases, and both would otherwise tie into silence — a canonical
 *  form is stronger evidence of identity than a borrowed one). */
function focusScore(text: string, e: FocusCandidate): number {
  const names: Array<[string, boolean]> = ([[e.name, true]] as Array<[string, boolean]>)
    .concat((Array.isArray(e.aliases) ? e.aliases : []).map((a) => [a, false] as [string, boolean]))
    .filter(([n]) => !!n);
  let score = 0;
  for (const [n, primary] of names) {
    if (!namesStatedIn(text, String(n))) continue;          // (a) identity, whole — candidacy
    const weight = distinctiveTokens(String(n)).reduce((a, t) => a + t.length, 0) * 2 + (primary ? 1 : 0);
    if (weight > score) score = weight;
  }
  return score;
}

export function findEntityFocus(
  question: string,
  ents: FocusCandidate[],
  opts?: { evidenceOnly?: boolean },
): { id: string; name: string } | null {
  const text = opts?.evidenceOnly ? askEvidenceText(question) : String(question ?? '');
  if (!text.trim()) return null;
  const scored = ents.map((e) => ({ e, score: focusScore(text, e) })).filter((s) => s.score > 0);
  if (!scored.length) return null;
  const top = Math.max(...scored.map((s) => s.score));
  const winners = scored.filter((s) => s.score === top);
  if (winners.length !== 1) return null;                    // (d) ambiguity is a refusal
  return { id: winners[0].e.id, name: winners[0].e.name };
}

/** THE FILING CLAIM — what the composer's "About X? · File it" chip may offer. The strictest read
 *  of the law: the user's own words (b), against TRACKED projects only (c). An untracked
 *  machine-founded entity is never suggested as a home; one weak or ambiguous signal serves no
 *  chip at all. */
export function suggestFilingFocus(question: string, ents: FocusCandidate[]): { id: string; name: string } | null {
  const tracked = ents.filter((e) => e.tracked === true);
  if (!tracked.length) return null;
  return findEntityFocus(question, tracked, { evidenceOnly: true });
}

/** Assemble a compact, bounded snapshot of the brain — everything the answer may reason over.
 *  Exported: the converse core grounds global-scope open turns on the SAME read.
 *
 *  ONE USER GROUNDING (stabilization W2.2, invariant 5): the world half of this snapshot IS
 *  `assembleUserGrounding` (lib/room/user-grounding.ts) — the user-scope twin of the room
 *  grounding. This lane used to build a PRIVATE world here (a replies-owed block off raw `rule_type`
 *  over the last 60 emails, commitments on its own status list), bypassing the judge, the notice
 *  floors, the seat law and the deck's demotion set — so the chat could assert a debt the deck had
 *  floored. There is no second assembly of the user's world in this file any more.
 *
 *  With `focusQuery` (THE ONE-GROUNDING UNIFICATION): when the question NAMES a registered
 *  entity, that entity's FULL room grounding — the same assembled page the room itself reads —
 *  is appended as the FOCUSED WORK block, so an answer from the Home and an answer from the
 *  room structurally cannot disagree. */
export async function buildBrainSnapshot(
  supabase: SupabaseClient, userId: string, focusQuery?: string,
  /** THE PINNED FOCUS (W19.2a): asked from INSIDE a project room, the focus is that room — by scope,
   *  never guessed from the words — so the room's catch-up and the Home's are one answer. */
  opts: { focusEntityId?: string | null } = {},
): Promise<{ text: string; refs: Map<string, AskRef> }> {
  const { assembleUserGrounding } = await import('@/lib/room/user-grounding');
  const world = await assembleUserGrounding(supabase, userId);
  const refs = new Map<string, AskRef>(world.refs);
  const parts: string[] = [world.text];
  // The focus candidates are the grounding's own project rows — one read, one registry.
  const ents: FocusCandidate[] = world.facts.projects.map((p) => ({ id: p.id, name: p.name, aliases: p.aliases, tracked: p.tracked }));

  // ── THE ONE-GROUNDING UNIFICATION (one-surface arc, Aug 5): a question that NAMES a body of
  // work gets that entity's FULL room grounding appended — the same assembled page the room's
  // brief/responder/agent loop read, so "status on X?" from the Home and from X's room are the
  // same answer by construction. The block's own [L#]/[F#] tags are STRIPPED (they would collide
  // with the snapshot's tag space and mint wrong links); the entity's [E#] chip carries the link.
  // Non-fatal: a grounding failure serves the plain snapshot (the pre-unification status quo). ──
  if (focusQuery?.trim() || opts.focusEntityId) {
    try {
      // THE USER'S OWN WORDS (clause b): a pasted email repoints nothing — the grounding follows
      // what the user says this conversation is about, and degrades to the plain snapshot when the
      // evidence is only transported text. A PINNED focus (the room the user is asking from) is
      // not a claim read from words at all — it is where the question was asked.
      const pinned = opts.focusEntityId
        ? { id: opts.focusEntityId, name: ents.find((e) => e.id === opts.focusEntityId)?.name ?? '' }
        : null;
      const focus = pinned ?? (focusQuery?.trim() ? findEntityFocus(focusQuery, ents, { evidenceOnly: true }) : null);
      if (focus) {
        const { assembleRoomGrounding } = await import('@/lib/room/grounding');
        const g = await assembleRoomGrounding(supabase, userId, { kind: 'entity', entityId: focus.id });
        if (!focus.name) focus.name = g.entity?.name ?? 'this project';
        const eTag = [...refs.entries()].find(([, r]) => r.kind === 'entity' && r.id === focus.id)?.[0];
        if (!eTag) refs.set('E0', { id: focus.id, kind: 'entity', label: focus.name, href: entHref(focus.id) });
        parts.push(
          `THE FOCUSED WORK — ${pinned ? `the question is asked from inside "${focus.name}"` : `the question names "${focus.name}"`}${eTag ? ` (reference as [${eTag}])` : ' (reference as [E0])'}. ` +
          `This is its full current page — deeper and MORE CURRENT than its one-line summary above; ` +
          `prefer it for anything about this work:\n` +
          // THE CONTEXT BUDGET (W2.7): a declared cut with its rule, never a raw head-slice.
          clipWithRule(g.text.replace(/\[(?:L|F)\d+\]\s?/g, ''), 3200) +
          // ONE LAW, ONE COPY (Sep 8): the focused page can carry a GROUND EVIDENCE block, and a
          // Home answer that ranked the board above the world would contradict the room's own
          // brief — "status on X?" must be the same answer from both doors, settlements included.
          `\n${GROUND_EVIDENCE_RULE}`,
        );
      }
    } catch { /* the focus is an enhancement — the plain snapshot still answers */ }
  }

  return { text: parts.join('\n\n') || '(nothing active right now)', refs };
}

// ── THE RECORDS-ONLY QUESTION LANE IS RETIRED (W22 — THE HOME CHAT IS ONE ASSISTANT). `answerHomeQuestion`
// answered every "question" from this snapshot alone, as JSON, in 1-3 plain sentences at 450 tokens —
// and served "I don't have anything on that yet." for any parse failure, a truncated answer included.
// A workshop asking the chat to facilitate ("ask me one question at a time") was refused by it. The
// Home chat is now ONE tool-using conversation (lib/converse `agentLoop`) that reads THIS snapshot as
// its context page (`buildBrainSnapshot`, unchanged) and grounds every claim about the user's work in
// it or in a tool result — while following instructions freely. The file lane it carried is the
// loop's `find_file` / `search_knowledge_base` tools.
