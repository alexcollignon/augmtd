// ════════════════════════════════════════════════════════════════════════════════════════════════
// HOME ASK — the entry to the brain. A grounded Q&A over the ONE registry: the user's active bodies of
// work (entities: state / next-move / who-owes / category), the people needing attention, open
// commitments, today's schedule, and recent replies they owe. ONE reasoned pass, GROUNDED — it answers
// only from this context, cites the items it used, and is honest ("nothing on that") rather than guessing
// (the trust invariant; hallucination is what kills these products). Read-only in v1; actions come later.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import type { SupabaseClient } from '@supabase/supabase-js';
import { aiCall } from '@/lib/ai/call';
import { resolveFileUniversal } from '@/lib/knowledge/resolve';
// THE ONE IDENTITY PRIMITIVE — never a second generic-word list. `namesStatedIn`/`distinctiveTokens`
// are built on GENERIC_WORK_WORDS (lib/entities/recognize), the same law the case pre-pass, the
// workflow-scope seam and the named-subject veto speak.
import { namesStatedIn, distinctiveTokens } from '@/lib/workflows/case-step';
import { topMessageOf } from '@/lib/inbox/top-message';
import { projectHref } from '@/lib/room/project-href';
import { GROUND_EVIDENCE_RULE } from '@/lib/room/ground-evidence';
import { REACH_CONTRACT } from '@/lib/converse/reach';
// THE REF IS ITS TAG — the ONE ref grammar, shared with the renderer (lib/home/ask-refs.ts).
import { resolveAskRefs, ASK_TAG_CAP } from '@/lib/home/ask-refs';
import { clipWithRule } from '@/lib/utils/pack-context';
import { clipLabel } from '@/lib/utils/clip-for-prompt';

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
export async function buildBrainSnapshot(supabase: SupabaseClient, userId: string, focusQuery?: string): Promise<{ text: string; refs: Map<string, AskRef> }> {
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
  if (focusQuery?.trim()) {
    try {
      // THE USER'S OWN WORDS (clause b): a pasted email repoints nothing — the grounding follows
      // what the user says this conversation is about, and degrades to the plain snapshot when the
      // evidence is only transported text.
      const focus = findEntityFocus(focusQuery, ents, { evidenceOnly: true });
      if (focus) {
        const { assembleRoomGrounding } = await import('@/lib/room/grounding');
        const g = await assembleRoomGrounding(supabase, userId, { kind: 'entity', entityId: focus.id });
        const eTag = [...refs.entries()].find(([, r]) => r.kind === 'entity' && r.id === focus.id)?.[0];
        if (!eTag) refs.set('E0', { id: focus.id, kind: 'entity', label: focus.name, href: entHref(focus.id) });
        parts.push(
          `THE FOCUSED WORK — the question names "${focus.name}"${eTag ? ` (reference as [${eTag}])` : ' (reference as [E0])'}. ` +
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

export async function answerHomeQuestion(
  supabase: SupabaseClient, userId: string, question: string, history: AskTurn[] = [],
): Promise<AskAnswer> {
  const { text: snapshot, refs } = await buildBrainSnapshot(supabase, userId, question);
  // FILE LANE via THE ONE RESOLVER (single-source #2): question-driven retrieval across pool → KB →
  // connected drives, so "do we have the deck?" is answerable. Top hits ride as [F#] refs. Non-fatal.
  let fileBlock = '';
  try {
    const fCands = await resolveFileUniversal(supabase, { userId }, question, 4);
    if (fCands.length) {
      const lines = fCands.map((c, i) => {
        const id = `F${i + 1}`;
        refs.set(id, { id, kind: 'file', label: c.filename, href: null });
        // A LABEL IS NOT AN EXCERPT (clip-for-prompt.ts): this is a one-line file preview, not a
        // prompt-budget excerpt — `clipLabel` ends at a word boundary without a marker (a raw
        // `.slice()` produced mid-word chrome here, the same class the report-back label bug was).
        return `[${id}] ${c.filename}${c.snippet ? ` — ${clipLabel(c.snippet, 90)}` : ''}${c.source === 'gdrive' || c.source === 'onedrive' ? ` (${c.source})` : ''}`;
      });
      fileBlock = `\n\nFILES that may relate to the question (reference as [F#]):\n${lines.join('\n')}`;
    }
  } catch { /* no file lane */ }
  const priorTurns = history.slice(-6).map((t) => `${t.role === 'user' ? 'THEM' : 'YOU'}: ${t.text}`).join('\n');
  const prompt =
    // THE PROMPT STOPS OVERCLAIMING (Wave 1, Sep 18): this sentence used to promise "their whole
    // working context … calendar", and the snapshot held only TODAY — so when the user asked about
    // two future weeks the model, told it holds the calendar, answered from nothing and said "free".
    // A prompt that overstates its context is an instruction to confabulate. It now enumerates
    // exactly what the snapshot carries, and states the calendar's reach and its EDGE.
    `You are the user's assistant inside their work app. The context below is what you hold: the work ` +
    `they owe as the app itself judges it (replies, promises, actions — the SAME rows their Home deck ` +
    `shows; a thing not listed there is not owed as far as this app knows), what they are waiting on, ` +
    `their projects, the people needing attention, their recent deeds, today's schedule — and their ` +
    `calendar for TODAY AND THE NEXT 14 DAYS ONLY. Answer like a sharp, ` +
    `calm colleague who already knows their world, GROUNDED STRICTLY in that context.\n\n` +
    `THE CALENDAR RULE: availability, free time and scheduling come ONLY from the calendar block below — ` +
    `never from memory, never from what sounds likely. NEVER state or imply someone is free or busy on a ` +
    // THE REACH VALVE OUTRANKS THE CONFESSION (Sep 18, found by the R3 gate): this sentence used to
    // read "beyond those 14 days you cannot see the calendar: say so plainly and offer to check" —
    // Wave 1's honesty fix, written when confessing WAS the best this toolless lane could do. With the
    // valve mounted that instruction became the thing BLOCKING it: asked about a day 35 days out the
    // model dutifully offered to check instead of emitting the token that would have gone and checked.
    // An honest edge is a floor, never a ceiling — a question beyond the window IS the REACH case.
    `day you cannot see. A question about a day BEYOND this window is exactly the REACH case below: ` +
    `do not answer it from here and do not offer to check — emit the token and the lookup happens. ` +
    `If the calendar block itself says NO CALENDAR IS SYNCED, availability is unknowable here: say ` +
    `plainly that no calendar is connected, never call a day free or busy, and never offer a check. ` +
    `Weekday names are already computed in the context — use them verbatim and never work one out yourself.\n\n` +
    `THEIR CONTEXT:\n${snapshot}${fileBlock}\n\n` +
    (priorTurns ? `EARLIER IN THIS CHAT:\n${priorTurns}\n\n` : '') +
    `THEIR QUESTION: ${question}\n\n` +
    `Rules:\n` +
    // FIRST, NOT LAST (Sep 18, the R3 gate): the reach clause sat at the BOTTOM of this list, behind
    // "say so plainly" — and the model obeyed the rule it read first. A clause that loses to the rule
    // it is meant to outrank is not mounted; prominence is part of the contract.
    `- ${REACH_CONTRACT}\n` +
    `- Answer ONLY from the context (after the REACH rule above has been considered). If it doesn't cover the question AND no lookup could, say so plainly ("I don't have anything on that yet") — NEVER invent people, dates, or facts.\n` +
    `- HARD LIMITS (exceeding them is a failed answer): a simple question = 1-3 sentences. A summary question ("what did I miss", "plan my week") = at most 3 short paragraphs and 100 words TOTAL, separated by blank lines. Pick the 3-4 things that matter MOST and STOP — never inventory; the deck below the chat already lists everything. End a summary with the one thing you'd do first.\n` +
    `- PLAIN PROSE ONLY: no markdown (no **bold**, no headers, no tables, no bullet lists). Whenever the answer runs past two sentences, break it into short paragraphs separated by a BLANK LINE — never one solid block. Never place two refs back-to-back — connect them with words.\n` +
    // ONE NUMBER, ONE SOURCE (Sep 21): the ceiling the prompt states is the constant the code
    // enforces — a prompt-only limit is a hope. Extra tags are stripped, never shown raw.
    `- HARD LIMIT: at most ${ASK_TAG_CAP} tags total, ONE id per bracket ([E7] — NEVER [E7, E8]), placed immediately AFTER the thing it names (\"the pilot [E10]\"), never dangling at a sentence end. The app turns each into a link.\n` +
    `- Reason across items when useful (connect a deal to its commitments / its meeting / who owes what).\n` +
    `Return ONLY JSON: {"answer":"<the answer, with [E#]/[C#]/[R#]/[W#]/[F#] tags>","refs":["E1","C2","F1",...]}`;

  // BUDGET ROUTING (one policy, deterministic): lookups run on the CHEAP tier; only synthesis-intent
  // questions ("what did I miss", "prioritize", "should I…") escalate to deep reasoning. Typical asks
  // become ~5-8x cheaper with no visible loss on the easy majority.
  const deep = /miss|summar|priorit|plan\b|why\b|should|think|advice|catch me up|overview|strategy|recommend/i.test(question) || question.length > 120;
  const res = await aiCall<{ answer?: string; refs?: string[] }>({
    userId, supabase, shape: deep ? { output: 'json', reasoning: 'deep' } : { output: 'json' }, prompt, maxTokens: 450, temperature: 0.2, source: 'brain_synthesis',
  });
  const raw = String(res.json?.answer || '').trim() || "I don't have anything on that yet.";
  // THE REF IS ITS TAG (Sep 21 — the wrong-object-door incident, lib/home/ask-refs.ts): the served
  // set is derived from the tags the answer actually PLACES, resolved by id against this snapshot —
  // never from the model's declared list in declaration order (which the renderer then walked
  // positionally, so one grouped bracket handed the reader two chips belonging to other work).
  // The declared `refs` array is now only a hint we no longer need; the prose is the record.
  const { text: answer, refs: outRefs } = resolveAskRefs(raw, (tag) => refs.get(tag));
  return { answer, refs: outRefs };
}
