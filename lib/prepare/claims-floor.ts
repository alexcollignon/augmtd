// ════════════════════════════════════════════════════════════════════════════════════════════════
// W28.7 · THE CLAIMS FLOOR — a specific the material does not supply never reaches the user as fact.
//
// Found by the W28 surfaces eval: narrative deliverables (LinkedIn posts, case-study stories) written by
// the conversation model kept adding specifics the user never gave — "a few weeks ago", "four months in",
// "chasing documents, waiting on approvals" — despite the conduct rule against it, and the same model
// with a plain prompt did the same. A rule the writer must remember is not a floor. This is:
//   1 · ONE model call NOMINATES: it lists every concrete claim in the draft (time phrases, numbers,
//       named events, anecdotes, before-states and causes stated as fact, quotes) with the exact span,
//       whether the material supports it, and a short placeholder for the ones it does not.
//   2 · CODE APPLIES: each unsupported span that occurs VERBATIM in the draft is replaced by its
//       [PLACEHOLDER] (the deliver-first rule's slot for what only the user knows). A span that is not
//       verbatim is ignored — the model never rewrites the draft, it only points.
// Fail-open: any error returns the draft unchanged (the floor is an enhancement, never a blocker).
// ════════════════════════════════════════════════════════════════════════════════════════════════
import type { SupabaseClient } from '@supabase/supabase-js';
import { aiCall } from '@/lib/ai/call';
import { clipForPrompt, EXCERPT_RULE } from '@/lib/utils/clip-for-prompt';

export type ClaimVerdict = { quote: string; supported: boolean; placeholder?: string; /** remove = the text reads fine without it (a flourish); placeholder = the piece needs the fact */ action?: 'remove' | 'placeholder'; /** the material's own words for an overstated claim ("an admin" for "a dedicated admin") */ correction?: string };

// W43 · the slot helpers + the deterministic work-claims net live in the PURE leaf (lib/prepare/work-claims.ts);
// re-exported here so every existing importer keeps its import.
import { isGenericSlot, asPlaceholder } from '@/lib/prepare/work-claims';
export { isGenericSlot, asPlaceholder, COMMITMENT_OR_AVAILABILITY, unsupportedWorkClaims, unsupportedPromiseTiming, workClaimObjection, slotUnsupportedWork } from '@/lib/prepare/work-claims';
export type { WorkClaim } from '@/lib/prepare/work-claims';

/** A claim that states something checkable: a number, an amount, a date or time word, or a name (a capitalised
 *  word after the first). Pure. */
export function isConcreteClaim(quote: string): boolean {
  const q = String(quote ?? '').trim();
  if (/[\d€$£%]/.test(q)) return true;
  if (/\b(today|tomorrow|yesterday|tonight|ago|last|next|earlier|later|week|weeks|month|months|year|years|day|days|hour|hours|morning|afternoon|evening|monday|tuesday|wednesday|thursday|friday|saturday|sunday|january|february|march|april|may|june|july|august|september|october|november|december|q[1-4])\b/i.test(q)) return true;
  return q.split(/\s+/).slice(1).some((w) => /^[A-Z][\p{L}'’-]+/u.test(w.replace(/^["'“‘(]/, '')));
}

/** Apply verdicts: every unsupported span found verbatim is replaced by its placeholder. Pure. */
export function applyClaimVerdicts(text: string, verdicts: ClaimVerdict[], material?: string): { text: string; replaced: string[] } {
  let out = String(text ?? '');
  const replaced: string[] = [];
  // Longest first, so a span inside a longer unsupported span is not replaced twice.
  const bad = verdicts.filter((v) => v && v.supported === false && typeof v.quote === 'string')
    .map((v) => ({ ...v, quote: v.quote.trim() }))
    .filter((v) => v.quote.length >= 3 && v.quote.length <= 240)
    .sort((a, b) => b.quote.length - a.quote.length);
  for (const v of bad) {
    if (!out.includes(v.quote)) continue;
    // A removal is for a whole sentence of prose. Inside a table row, or a fragment of a sentence, removing
    // leaves a broken cell or a broken sentence (eval round 11: "€ ()", "The isn't worth") — slot it instead.
    const inTable = out.split('\n').some((l) => l.trim().startsWith('|') && l.includes(v.quote));
    const wholeSentence = /[.!?]["'”’)]?$/.test(v.quote) && /^[A-Z0-9"'“‘(\[]/.test(v.quote);
    // …and a list item whose whole content is the span keeps a slot (eval: a "2." left empty in three hooks).
    // (any line — a list item or a standalone bold line — whose whole content is the span keeps a slot)
    const bare = (x: string) => x.replace(/^\s*(\d+[.)]|[-*•>])\s+/, '').replace(/[*_"“”#]/g, '').trim();
    const wholeItem = out.split('\n').some((l) => bare(l) !== '' && bare(l) === bare(v.quote));
    // …a TIME PHRASE inside a promise ("in the next few days", "by Thursday") is removable too: the promise stays, undated.
    const timePhrase = /^(by|before|on|within|in the next|over the next|end of|by end of)\b[^.!?\n]{0,40}$/i.test(v.quote.trim());
    const remove = v.action === 'remove' && !inTable && !wholeItem && (wholeSentence || timePhrase);
    // A correction is the MATERIAL'S OWN WORDS — anything else (the checker's commentary leaking into the draft,
    // found in the full eval: "calculation is correct … but material doesn't state the total") is not used.
    const corr = typeof v.correction === 'string' ? v.correction.trim() : '';
    const correction = corr && corr.length <= 80 && material != null && material.toLowerCase().includes(corr.toLowerCase()) ? corr : null;
    // Prefer removing over slotting whenever the span can go (a whole sentence, a time phrase): a slot is
    // for what the piece NEEDS, and a generic-named slot is never better than a clean removal.
    const removable = !inTable && !wholeItem && (wholeSentence || timePhrase);
    const useRemove = remove || (removable && (v.action !== 'placeholder' || isGenericSlot(v.placeholder)));
    // W36 · A SLOT IS FOR A CONCRETE FACT (eval handoff.result: posts came back with "[WHO FELT THIS REACTION]",
    // "[CONFIRM: What stuck with us was what their…]", "[N/A]" — slots where the writing was fine). A claim with
    // no number, date, time, name or amount in it (a reaction, a cause, a description) is never slotted: a
    // trailing clause set off by a comma or dash is cut, and anything else is left as written.
    if (!correction && !useRemove && !isConcreteClaim(v.quote)) {
      const esc = v.quote.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const trailing = new RegExp(`\\s*(?:,|—|–| -)\\s*${esc}(?=[.!?])`);
      if (!inTable && trailing.test(out)) { out = out.replace(trailing, ''); replaced.push(v.quote); }
      continue;
    }
    out = out.split(v.quote).join(correction ?? (useRemove ? '' : asPlaceholder(v.placeholder, v.quote)));
    replaced.push(v.quote);
  }
  // One slot per thing: identical slots joined by "or"/"and"/"," collapse into one.
  out = out.replace(/(\[[^\]\n]+\])(\s*(?:,|or|and|\/)\s*\1)+/gi, '$1');
  // Tidy what a removal leaves: doubled spaces, a space before punctuation, a line of only punctuation.
  out = out.split('\n').map((l) => l.replace(/[ \t]{2,}/g, ' ').replace(/\s+([.,;:!?])/g, '$1').replace(/^\s*[,;:—–-]\s*/, '').trimEnd())
    .filter((l, i, a) => !(l.trim() === '' && (a[i - 1] ?? '').trim() === '')).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return { text: out, replaced };
}

/** A sentence where the writer vouches for its own faithfulness ("I've kept the facts exactly as stated",
 *  "both stick to what you gave me") — the reader checks that; the claim is never evidence, and the eval
 *  found it standing beside the very additions it denied. */
const SELF_VOUCH = /\b(I'?ve|I have|I|both|all|each|they|these|this|it)\b[^.!?\n]{0,40}\b(kept|keep|keeps|stuck|stick|sticks|stay|stays|stayed)\b[^.!?\n]{0,40}\b(the facts|what you (gave|told|shared|provided)|as (stated|provided|given|approved)|exactly|approved facts|no embellish\w*|nothing (added|invented))/i;

/** Drop self-vouching sentences (pure; a line that becomes empty is dropped). */
export function stripSelfVouching(text: string): string {
  return String(text ?? '').split('\n').map((line) => {
    if (!SELF_VOUCH.test(line)) return line;
    const kept = line.split(/(?<=[.!?])\s+/).filter((sentence) => !SELF_VOUCH.test(sentence)).join(' ').trim();
    return kept === '' ? null : kept;
  }).filter((l): l is string => l !== null).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** The floor gutted the work: a list item left as nothing but a slot, or three or more slots. Pure. */
export function flooringGutted(r: { text: string; replaced: string[] }): boolean {
  if (!r.replaced.length) return false;
  const slots = (r.text.match(/\[[A-Z0-9][^\]\n]{0,40}\]/g) ?? []).length;
  // A line (list item or standalone) left as nothing but a slot.
  const emptyItem = r.text.split('\n').some((l) => /^\s*((\d+[.)]|[-*•])\s*)?[*_]*\[[^\]]+\][*_]*\s*[.!?]?\s*$/.test(l));
  return emptyItem || slots >= 3;
}


/** Nominate (one call) + apply (code). `material` is everything the writer was given. */
export async function groundClaims(admin: SupabaseClient, userId: string, args: { draft: string; material: string; /** 'commitments' = check ONLY availability / dated commitments / progress stated for the user (a drafted message) */ focus?: 'all' | 'commitments' }): Promise<{ text: string; replaced: string[] }> {
  const draft = String(args.draft ?? '').trim();
  if (draft.length < 80 || !String(args.material ?? '').trim()) return { text: draft, replaced: [] };
  try {
    const res = await aiCall<{ claims?: ClaimVerdict[] }>({
      userId, supabase: admin, shape: { output: 'json', reasoning: 'deep' }, temperature: 0, maxTokens: 3000, source: 'task_preparation',
      prompt:
        `You check a draft against the material its writer was given. ${EXCERPT_RULE}\n\n` +
        `THE MATERIAL (everything the writer had):\n${clipForPrompt(args.material, 12000)}\n\n` +
        `THE DRAFT:\n${clipForPrompt(draft, 8000)}\n\n` +
        (args.focus === 'commitments'
          ? `THIS IS A MESSAGE THE USER WILL SEND. Check ONLY what it commits the user to: (a) a stated AVAILABILITY — ` +
            `a day, date or time the user is free or that "works" for them; (b) a DATED PROMISE of action — "I'll send ` +
            `it by Thursday", "in the next few days", "by end of day". A promise the user ALREADY made in the thread, or ` +
            `a deadline the other side set that the reply simply accepts ("before Friday" when they asked for it before ` +
            `Friday), is SUPPORTED — and so is restating a date or fact already in the thread (confirming a delivery ` +
            `date the user gave earlier): never touch those. Nothing else is a claim here. For an unsupported DATE in a promise, quote only the ` +
            `time phrase and "remove" it (the promise stays, undated); for an unsupported availability use a slot ` +
            `(placeholder "YOUR AVAILABILITY") unless the sentence reads fine without it.\n`
          : '') +
        `ONLY CONCRETE FACTS COUNT: numbers and quantities; dates, days and time phrases; named people, companies, ` +
        `products or events; quotes; results and outcomes; a specific before-state or cause; a commitment, a ` +
        `deadline or an availability stated on the user's behalf ("I'll send it Thursday", "Tuesday works for ` +
        `me"). A general line, a rhetorical question, an opinion or a benefit phrased generally ("remote hires ` +
        `shouldn't spend week one hunting for logins") is NOT a claim — never list it, even when no material ` +
        `was given.\n` +
        `Go through the draft SENTENCE BY SENTENCE. For every concrete fact a sentence states, decide whether the material ` +
        `gives it. Facts include: time phrases ("a few weeks ago", "in month one", "last week", "four months in"); ` +
        `numbers; how things were BEFORE or WHY ("chasing documents, waiting on approvals", ` +
        `"the process had grown"); what was done or built and how it works; reactions and feelings ("that stung", ` +
        `"I wasn't expecting"); results; named events; quotes and who said them. A rewording or reordering of what ` +
        `the material says is supported, and so is a figure computed from it (a total, a difference, a ` +
        `percentage) — never list those; opinion, rhythm and a general lesson are not facts.\n` +
        `Return ONLY the facts the material does NOT give, each as:\n` +
        `- "quote": the shortest EXACT span of the draft that states it (copied character for character — a clause, ` +
        `not the whole paragraph),\n` +
        `- "supported": false,\n` +
        `- "action": "remove" when the text reads fine without it (a flourish, an added detail — then quote the whole ` +
        `sentence or clause WITH its punctuation), or "placeholder" when the piece needs the fact to make sense,\n` +
        `- "placeholder": 2-6 words NAMING what the user must supply, e.g. "THE DAY YOU CAN MEET", "WHEN THE QUOTE ` +
        `WILL BE READY", "WHAT SLOWED ONBOARDING" — never a generic word like "DETAIL" or "WHEN".\n` +
        `Prefer "remove" for flourishes, but NEVER list anything the material gives (what was used or done, a ` +
        `stated result, a quote) — the point is to cut additions, not substance. A stronger word for what the ` +
        `material says ("a dedicated admin" for "an admin") is an addition: quote the phrase and give the material's ` +
        `own words as "correction" (e.g. "an admin") — a correction beats a placeholder whenever the material says it. ` +
        `A fact that cites a source link counts as given. JSON only: ` +
        `{"claims":[{"quote":"…","supported":false,"action":"remove|placeholder","placeholder":"…","correction":"… (optional)"}]}`,
    });
    const claims = Array.isArray(res.json?.claims) ? res.json!.claims! : [];
    return applyClaimVerdicts(draft, claims, String(args.material ?? ''));
  } catch {
    return { text: draft, replaced: [] };
  }
}
